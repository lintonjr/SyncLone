#!/usr/bin/env bash
# $API e companhia são constantes literais sem espaço, repetidas em centenas de
# chamadas de curl. Citar as 534 ocorrências seria reescrever a suíte inteira
# por uma classe de erro que não pode acontecer aqui — e mexer em 657 linhas que
# funcionam é justamente como se quebra uma rede de segurança.
#
# SC2016 é a outra face da mesma moeda: as condições do `espere` vão entre aspas
# simples porque quem as avalia é o helper, a cada tentativa — expandir na
# chamada congelaria o resultado da primeira e a espera nunca terminaria.
# shellcheck disable=SC2086,SC2016
# Regressão de sistema do Mercadia.
#
# Sobe nada: assume a stack em pé (docker compose up -d) e exercita a API de
# ponta a ponta. Cada bloco corresponde a um achado que já custou caro, e a
# ideia é que ele nunca volte em silêncio. Cria dados próprios e os deixa no
# banco de teste — rode contra um ambiente descartável.
#
#   SP=/tmp/regressao bash scripts/regressao.sh
#
set -u
SP="${SP:-$(mktemp -d)}"

# shellcheck source=scripts/regressao-lib.sh
. "$(dirname "$0")/regressao-lib.sh"
S=$RANDOM$RANDOM
OT=$(mkorg "reg$S@t.local" "Reg Final")
PJ="regp$S@t.local"; reg "Jogador Reg" "$PJ"; PT=$(tok "$PJ")

sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

sec "1. Autenticação, papéis e validação"
chk "sem token -> 401" "$(code -X POST $API/events -F "name=X" -F "game=Magic" -F "date=2026-10-01T19:00:00Z")" "401"
chk "jogador não cria evento -> 403" "$(code -X POST $API/events -H "Authorization: Bearer $PT" -F "name=X" -F "game=Magic" -F "date=2026-10-01T19:00:00Z")" "403"
chk "erro traz código traduzível" "$(body $API/events/00000000-0000-0000-0000-000000000000 | jqp 'd.get("code")')" "api.eventNotFound"
chk "e mantém a frase de fallback" "$(body $API/events/00000000-0000-0000-0000-000000000000 | jqp '"error" in d')" "True"
chk "data inválida -> 400" "$(code -X POST $API/events -H "Authorization: Bearer $OT" -F "name=X" -F "game=Magic" -F "date=31/12/2026")" "400"

sec "2. C-01 · pontos com uma fonte só"
ID=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg1 $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "points_win=3" | jqp 'd["id"]')
for n in P1 P2 P3 P4; do body -X POST $API/events/$ID/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
fecha() { body $API/events/$1 | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('\n'.join(p['id'] for p in d['pairings'] if not p['result']))" > $SP/p.txt
  while read -r pid; do [ -n "$pid" ] && body -X PUT $API/events/$1/pairings/$pid -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"result":"player1"}' >/dev/null; done < $SP/p.txt; }
body -X POST $API/events/$ID/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $ID
body -X PUT $API/events/$ID -H "Authorization: Bearer $OT" -F "points_win=10" >/dev/null
body -X POST $API/events/$ID/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $ID
body $API/events/$ID > $SP/r1.json
chk "mesmo cartel, mesmo total" "$(jqp 'len({p["points"] for p in d["players"] if p["wins"]==1})' < $SP/r1.json)" "1"
chk "total = 4 vitórias x escala vigente" "$(jqp 'sum(p["points"] for p in d["players"])' < $SP/r1.json)" "40"
chk "coluna points saiu do banco" "$(docker compose exec -T mysql mysql -N -uroot -proot123 manasync -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='manasync' AND table_name='event_players' AND column_name='points';" 2>/dev/null)" "0"

sec "3. C-02 · rotação exata de 4 clãs"
CID=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg2 $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "tournament_format=clafronto" -F "pairing_method=swiss-less-repetition" -F "playoff_structure=clan4" | jqp 'd["id"]')
for c in Alfa Beta Gama Delta; do body -X POST $API/events/$CID/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"$c\",\"display_names\":[\"$c 1\",\"$c 2\",\"$c 3\",\"$c 4\"]}" >/dev/null; done
for _ in 1 2 3 4; do body -X POST $API/events/$CID/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $CID; done
body $API/events/$CID > $SP/r2.json
python3 - "$SP" > $SP/r2.txt <<'PY'
import json, itertools, collections, sys
SP = sys.argv[1]
d=json.load(open(SP+'/r2.json'))
cla={p['id']:p['clan_id'] for p in d['players']}
pares=collections.Counter(); mesmo=0
for p in d['pairings']:
    s=[p[f'player{i}_id'] for i in (1,2,3,4) if p[f'player{i}_id']]
    if len({cla[x] for x in s})<4: mesmo+=1
    for a,b in itertools.combinations(sorted(s),2): pares[(a,b)]+=1
print(len(pares), sum(1 for v in pares.values() if v>1), mesmo, len([p for p in d['pairings'] if p['result']=='bye']))
PY
read -r DIST REP MESMO BYES < $SP/r2.txt
chk "96 duplas distintas em 4 rodadas" "$DIST" "96"
chk "zero reencontro" "$REP" "0"
chk "nenhuma mesa com clã repetido" "$MESMO" "0"
chk "nenhum bye" "$BYES" "0"

sec "4. C-05 · playoff em duplas premia os dois parceiros"
body -X POST $API/events/$CID/playoffs/start -H "Authorization: Bearer $OT" >/dev/null
body $API/events/$CID > $SP/pre.json
FP=$(jqp '[p["id"] for p in d["pairings"] if p["round_id"]==d["rounds"][-1]["id"]][0]' < $SP/pre.json)
body -X PUT $API/events/$CID/pairings/$FP -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"result":"player1"}' >/dev/null
body $API/events/$CID > $SP/pos.json
python3 -c "
import json
a=json.load(open('$SP/pre.json')); b=json.load(open('$SP/pos.json'))
pa={p['id']:p for p in a['players']}; pb={p['id']:p for p in b['players']}
m=[p for p in a['pairings'] if p['round_id']==a['rounds'][-1]['id']][0]
s=[m['player%d_id'%i] for i in (1,2,3,4)]
g=[x for x in s if pb[x]['points']>pa[x]['points']]
print(len(g), len({pa[x]['clan_id'] for x in g}))" > $SP/pf.txt
read -r NG NC < $SP/pf.txt
chk "dois assentos pontuaram" "$NG" "2"
chk "e são do mesmo clã" "$NC" "1"

sec "5. C-07 · a liga conta pela mesma fonte do evento"
# Os quatro assentos da final viram contas, para aparecerem na classificação da
# liga — convidado sem conta não é correlacionável entre eventos. Depois a
# pergunta é uma só: liga e evento dizem o mesmo número para cada pessoa?
#
# Antes do C-07 não diziam. `routes/leagues.js` tinha um laço próprio, anterior à
# mesa de duplas, que dava derrota ao parceiro do vencedor — e a liga discordava
# do evento que a alimentava.
LIGA=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga C07 $S\",\"playoff_counts\":true}" | jqp 'd["id"]')
body -X PUT $API/events/$CID -H "Authorization: Bearer $OT" -F "league_id=$LIGA" >/dev/null
i=0
ASSENTOS=$(jqp '" ".join(str(m["player%d_id" % i]) for i in (1,2,3,4) for m in [[x for x in d["pairings"] if x["round_id"]==d["rounds"][-1]["id"]][0]])' < $SP/pos.json)
for seat in $ASSENTOS; do
  i=$((i+1)); EM="c07-$i-$S@t.local"; reg "C07 $i" "$EM"
  body -X PUT $API/events/$CID/players/$seat/link -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$EM\"}" >/dev/null
done
body $API/events/$CID > $SP/c07ev.json
body $API/leagues/$LIGA > $SP/c07lg.json
python3 - "$SP" > $SP/c07.txt <<'PYEOF'
import json, sys
SP = sys.argv[1]
ev = json.load(open(SP + '/c07ev.json'))
lg = json.load(open(SP + '/c07lg.json'))
doEvento = {p['user_id']: p for p in ev['players'] if p.get('user_id')}
daLiga = {r['user_id']: r for r in lg['standings']}
divergem = [u for u in doEvento if doEvento[u]['points'] != daLiga.get(u, {}).get('points')]
# a dupla que venceu a final: os dois assentos do clã vencedor
mesa = [p for p in ev['pairings'] if p['round_id'] == ev['rounds'][-1]['id']][0]
assentos = [mesa['player%d_id' % i] for i in (1, 2, 3, 4)]
porId = {p['id']: p for p in ev['players']}
claVencedor = porId[mesa[{'player1': 'player1_id', 'player2': 'player2_id',
                          'player3': 'player3_id', 'player4': 'player4_id'}[mesa['result']]]]['clan_id']
dupla = [porId[a] for a in assentos if porId[a]['clan_id'] == claVencedor]
naLiga = [daLiga.get(p['user_id'], {}).get('wins') for p in dupla]
print(len(daLiga), len(divergem), len(dupla), len(set(naLiga)))
PYEOF
read -r NL NDIV NDUP NWIN < $SP/c07.txt
chk "os quatro assentos entram na liga" "$NL" "4"
chk "liga e evento dizem o mesmo para cada um" "$NDIV" "0"
chk "a dupla vencedora tem dois assentos" "$NDUP" "2"
chk "e os dois com o mesmo número de vitórias" "$NWIN" "1"

sec "6. C-03 · evento encerrado só reabre"
E3=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg3 $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" | jqp 'd["id"]')
body -X POST $API/events/$E3/finish -H "Authorization: Bearer $OT" >/dev/null
chk "renomear depois do fim -> 400" "$(code -X PUT $API/events/$E3 -H "Authorization: Bearer $OT" -F "name=Novo")" "400"
# Reabrir carona num campo a mais e recusado: reabrir e so reabrir. E por isso
# que o front tem um `reopenEvent()` proprio em vez de montar o corpo na mao.
body -X POST $API/events/$E3/finish -H "Authorization: Bearer $OT" >/dev/null
chk "reabrir com um campo a mais -> 400" "$(code -X PUT $API/events/$E3 -H "Authorization: Bearer $OT" -F "status=ongoing" -F "name=Carona")" "400"
chk "e o torneio continua encerrado" "$(body $API/events/$E3 | jqp 'd["status"]')" "completed"
chk "reabrir -> 200" "$(code -X PUT $API/events/$E3 -H "Authorization: Bearer $OT" -F "status=ongoing")" "200"

sec "7. C-04 · SSE avisa editar e apagar"
# A rota escreve uma linha em branco assim que aceita a conexão (routes/events.js),
# e é por isso que dá para esperar o arquivo deixar de estar vazio em vez de
# chutar um segundo. O PID fica guardado para o curl não sobreviver à seção.
: > $SP/sse.txt
timeout 30 curl -sN "$API/events/$E3/stream" > $SP/sse.txt &
SSE_PID=$!
espere 15 "o stream SSE conectou" '[ -s "$SP/sse.txt" ]'
body -X PUT $API/events/$E3 -H "Authorization: Bearer $OT" -F "name=Reg3 editado" >/dev/null
espere 15 "PUT emite update" 'grep -q "data: update" "$SP/sse.txt"'
chk "PUT emite update" "$(grep -c 'data: update' $SP/sse.txt)" "1"
body -X DELETE $API/events/$E3 -H "Authorization: Bearer $OT" >/dev/null
espere 15 "DELETE emite deleted" 'grep -q "data: deleted" "$SP/sse.txt"'
chk "DELETE emite deleted" "$(grep -c 'data: deleted' $SP/sse.txt)" "1"
kill "$SSE_PID" 2>/dev/null || true
wait "$SSE_PID" 2>/dev/null || true

sec "8. Selo de entrada tardia não confunde eliminação com atraso"
E5=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg5 $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "playoff_structure=top4" | jqp 'd["id"]')
for n in A B C D E F G H; do body -X POST $API/events/$E5/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
for _ in 1 2; do body -X POST $API/events/$E5/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $E5; done
body -X POST $API/events/$E5/playoffs/start -H "Authorization: Bearer $OT" >/dev/null
body $API/events/$E5 > $SP/r5.json
chk "Top 4 iniciado, mas o suíço continua com 2 rodadas" "$(jqp 'd["swiss_rounds_total"]' < $SP/r5.json)" "2"
chk "ninguém eliminado vira entrada tardia" "$(jqp 'len([p for p in d["players"] if p["swiss_rounds_seated"] < d["swiss_rounds_total"]])' < $SP/r5.json)" "0"
body -X POST $API/events/$E5/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"display_name":"Tardio"}' >/dev/null
chk "mas quem entra depois continua marcado" "$(body $API/events/$E5 | jqp 'len([p for p in d["players"] if p["swiss_rounds_seated"] < d["swiss_rounds_total"]])')" "1"

sec "9. Regras antigas seguem de pé"
E4=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg4 $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "allow_byes=true" -F "confirm_players=true" | jqp 'd["id"]')
body -X POST $API/events/$E4/join -H "Authorization: Bearer $PT" > $SP/j.json
chk "inscrição com aprovação fica pendente" "$(jqp 'd["pending"]' < $SP/j.json)" "True"
PIDP=$(body $API/events/$E4 | jqp '[p["id"] for p in d["players"] if p["status"]=="pending"][0]')
body -X PUT $API/events/$E4/players/$PIDP -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"status":"active"}' >/dev/null
for n in Q1 Q2 Q3 Q4; do body -X POST $API/events/$E4/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
for _ in 1 2 3 4 5; do body -X POST $API/events/$E4/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $E4; done
body $API/events/$E4 > $SP/r4.json
python3 -c "
import json, collections
d=json.load(open('$SP/r4.json'))
n={p['id']:p['display_name'] for p in d['players']}
c=collections.Counter(n[p['player1_id']] for p in d['pairings'] if p['result']=='bye')
print(len(d['rounds']), max(c.values()) if c else 0, len(c))" > $SP/r4.txt
read -r NR MAXB DISTB < $SP/r4.txt
chk "A-16: 5 rodadas com 5 jogadores" "$NR" "5"
chk "A-16: ninguém tomou bye duas vezes" "$MAXB" "1"
chk "A-16: todos rodaram o bye" "$DISTB" "5"
RID=$(jqp 'd["rounds"][0]["id"]' < $SP/r4.json)
chk "A-17: cronômetro nasce parado" "$(jqp 'd["rounds"][-1]["timer_started_at"] is None' < $SP/r4.json)" "True"
chk "B-01: Clã Fronto trava pod_size" "$(body -X PUT $API/events/$CID -H "Authorization: Bearer $OT" -F "pod_size=2" | jqp 'd["pod_size"]')" "4"
chk "B-02: playoff incoerente -> 400" "$(code -X POST $API/events -H "Authorization: Bearer $OT" -F "name=X $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "playoff_structure=clan4")" "400"
chk "B-03: swiss_rounds_total exposto" "$(jqp '"swiss_rounds_total" in d' < $SP/r4.json)" "True"
chk "B-04: CSV de clãs" "$(body "$API/events/$CID/export?type=clans" -H "Authorization: Bearer $OT" | head -1 | grep -c 'Rank,Clã')" "1"
chk "A-01: upload não-imagem -> 400" "$(printf 'x' > $SP/x.txt; code -X POST $API/events -H "Authorization: Bearer $OT" -F "name=U $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "thumbnail=@$SP/x.txt;type=text/plain")" "400"
chk "apagar Clã Fronto (FK dos clãs) -> 200" "$(code -X DELETE $API/events/$CID -H "Authorization: Bearer $OT")" "200"

sec "10. Perfil público e vinculação de convidado"
E6=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg6 $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "allow_byes=true" | jqp 'd["id"]')
for n in Umbra Vega Wren; do body -X POST $API/events/$E6/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
body -X POST $API/events/$E6/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $E6
UMBRA=$(body $API/events/$E6 | jqp '[p["id"] for p in d["players"] if p["display_name"]=="Umbra"][0]')
chk "convidado não tem conta" "$(body $API/events/$E6 | jqp '[p["user_id"] for p in d["players"] if p["id"]=="'"$UMBRA"'"][0] is None')" "True"
chk "vincular convidado a uma conta -> 200" "$(code -X PUT $API/events/$E6/players/$UMBRA/link -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$PJ\"}")" "200"
chk "vincular de novo -> 409" "$(code -X PUT $API/events/$E6/players/$UMBRA/link -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$PJ\"}")" "409"
VEGA=$(body $API/events/$E6 | jqp '[p["id"] for p in d["players"] if p["display_name"]=="Vega"][0]')
chk "mesma conta duas vezes no evento -> 409" "$(code -X PUT $API/events/$E6/players/$VEGA/link -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$PJ\"}")" "409"
chk "quem não organiza não vincula -> 403" "$(code -X PUT $API/events/$E6/players/$VEGA/link -H "Authorization: Bearer $PT" -H 'Content-Type: application/json' -d "{\"email\":\"$PJ\"}")" "403"
UID_P=$(body $API/events/$E6 | jqp '[p["user_id"] for p in d["players"] if p["id"]=="'"$UMBRA"'"][0]')
body $API/users/$UID_P/profile > $SP/perfil.json
chk "perfil público responde sem token" "$(code $API/users/$UID_P/profile)" "200"
chk "a participação vinculada aparece no perfil" "$(jqp 'd["totals"]["events"] >= 1' < $SP/perfil.json)" "True"
chk "perfil nunca devolve e-mail" "$(jqp '"email" in d["user"]' < $SP/perfil.json)" "False"
chk "retrospecto do perfil e internamente coerente" "$(jqp 'd["totals"]["wins"] + d["totals"]["losses"] + d["totals"]["draws"] == d["totals"]["matches"]' < $SP/perfil.json)" "True"
chk "perfil inexistente -> 404" "$(code $API/users/00000000-0000-0000-0000-000000000000/profile)" "404"

sec "11. Métricas por liga"
MF="mf$S@t.local"; reg "Multiliga" "$MF"; MFT=$(tok "$MF")
MFID=$(body $API/users/me -H "Authorization: Bearer $MFT" | jqp 'd["id"]')
LA=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga Alfa $S\"}" | jqp 'd["id"]')
LB=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga Beta $S\"}" | jqp 'd["id"]')
torneio() {
  local extra=""
  [ -n "$3" ] && extra="-F league_id=$3"
  local eid
  eid=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=$1 $S" -F "game=MTG" -F "format=$2" -F "date=2026-10-01T19:00:00Z" -F "allow_byes=true" $extra | jqp 'd["id"]')
  body -X POST $API/events/$eid/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$MF\"}" >/dev/null
  for n in R1 R2 R3; do body -X POST $API/events/$eid/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
  body -X POST $API/events/$eid/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $eid
}
torneio MLa Commander500 "$LA"
torneio MLb Modern "$LA"
torneio MLc Standard "$LB"
torneio MLd cEDH ""
body $API/users/$MFID/profile > $SP/ml.json
chk "geral soma os quatro eventos" "$(jqp 'd["totals"]["events"]' < $SP/ml.json)" "4"
chk "tres recortes: duas ligas e os avulsos" "$(jqp 'len(d["by_league"])' < $SP/ml.json)" "3"
chk "a liga com duas etapas vem primeiro" "$(jqp 'd["by_league"][0]["events"]' < $SP/ml.json)" "2"
chk "avulsos por ultimo" "$(jqp 'd["by_league"][-1]["league_id"] is None' < $SP/ml.json)" "True"
chk "avulsos sem nome: quem rotula e a tela" "$(jqp 'd["by_league"][-1]["name"] is None' < $SP/ml.json)" "True"
chk "os recortes somam o geral" "$(jqp 'sum(b["events"] for b in d["by_league"]) == d["totals"]["events"]' < $SP/ml.json)" "True"
chk "e o cartel tambem" "$(jqp 'sum(b["wins"] for b in d["by_league"]) == d["totals"]["wins"]' < $SP/ml.json)" "True"
chk "nenhum recorte vazio" "$(jqp 'all(b["events"] > 0 for b in d["by_league"])' < $SP/ml.json)" "True"
chk "o campo leagues saiu da resposta" "$(jqp '"leagues" in d' < $SP/ml.json)" "False"
chk "quem joga uma liga so tem um recorte" "$(body $API/users/$UID_P/profile | jqp 'len(d["by_league"])')" "1"

sec "12. Notificações: código e teto"
NM="nt$S@t.local"; reg "Notificado" "$NM"; NMT=$(tok "$NM")
ENT=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Notif $S" -F "game=MTG" -F "date=2026-10-01T19:00:00Z" -F "allow_byes=true" | jqp 'd["id"]')
body -X POST $API/events/$ENT/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$NM\"}" >/dev/null
for n in N1 N2 N3; do body -X POST $API/events/$ENT/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
body -X POST $API/events/$ENT/rounds -H "Authorization: Bearer $OT" >/dev/null
body $API/notifications -H "Authorization: Bearer $NMT" > $SP/nt.json
chk "a notificacao guarda codigo" "$(jqp 'all(n["code"] for n in d)' < $SP/nt.json)" "True"
chk "e nao a frase pronta" "$(jqp 'all(n["message"] is None for n in d)' < $SP/nt.json)" "True"
chk "com os parametros para a tela montar" "$(jqp 'any(n.get("params") for n in d)' < $SP/nt.json)" "True"
chk "o aviso de rodada traz o numero" "$(jqp '[n["params"]["rodada"] for n in d if n["code"]=="notif.roundStarted"][0]' < $SP/nt.json)" "1"

sec "13. Badges"
python3 -c "
import base64,sys
sys.stdout.buffer.write(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='))" > $SP/badge.png
printf 'x' > $SP/naoimg.txt
head -c 600000 /dev/urandom > $SP/grande.png
BP="bgp$S@t.local"; reg "Premiado" "$BP"; BPT=$(tok "$BP")
BPID=$(body $API/users/me -H "Authorization: Bearer $BPT" | jqp 'd["id"]')
chk "criar badge -> 201" "$(code -X POST $API/badges -H "Authorization: Bearer $OT" -F "name=Campeao $S" -F "image=@$SP/badge.png;type=image/png")" "201"
BID=$(body $API/badges -H "Authorization: Bearer $OT" | jqp 'd[0]["id"]')
chk "nome repetido do mesmo dono -> 409" "$(code -X POST $API/badges -H "Authorization: Bearer $OT" -F "name=Campeao $S" -F "image=@$SP/badge.png;type=image/png")" "409"
chk "sem imagem -> 400" "$(code -X POST $API/badges -H "Authorization: Bearer $OT" -F "name=Sem $S")" "400"
chk "arquivo nao-imagem -> 400" "$(code -X POST $API/badges -H "Authorization: Bearer $OT" -F "name=Ruim $S" -F "image=@$SP/naoimg.txt;type=text/plain")" "400"
chk "imagem acima de 512 KB -> 400" "$(code -X POST $API/badges -H "Authorization: Bearer $OT" -F "name=Grande $S" -F "image=@$SP/grande.png;type=image/png")" "400"
chk "jogador comum nao cria badge -> 403" "$(code -X POST $API/badges -H "Authorization: Bearer $PT" -F "name=X $S" -F "image=@$SP/badge.png;type=image/png")" "403"
chk "entregar -> 201" "$(code -X POST $API/badges/$BID/award -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$BP\"}")" "201"
chk "a mesma badge duas vezes para a mesma pessoa -> 409" "$(code -X POST $API/badges/$BID/award -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$BP\"}")" "409"
BP2="bgq$S@t.local"; reg "Premiado 2" "$BP2"
chk "a mesma badge para outro jogador -> 201" "$(code -X POST $API/badges/$BID/award -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$BP2\"}")" "201"
OT2=$(mkorg "bgo$S@t.local" "Outro Org")
chk "so quem criou entrega -> 403" "$(code -X POST $API/badges/$BID/award -H "Authorization: Bearer $OT2" -H 'Content-Type: application/json' -d "{\"email\":\"$BP\"}")" "403"
chk "so quem criou apaga -> 403" "$(code -X DELETE $API/badges/$BID -H "Authorization: Bearer $OT2")" "403"
chk "apagar badge ja entregue -> 409" "$(code -X DELETE $API/badges/$BID -H "Authorization: Bearer $OT")" "409"
chk "a badge aparece no perfil" "$(body $API/users/$BPID/profile | jqp 'len(d["badges"])')" "1"
UB=$(body $API/users/me/badges -H "Authorization: Bearer $BPT" | jqp 'd[0]["id"]')
chk "o jogador esconde" "$(body -X PUT $API/users/me/badges/$UB -H "Authorization: Bearer $BPT" -H 'Content-Type: application/json' -d '{"visible":false}' | jqp 'd["visible"]')" "0"
chk "sumiu para o visitante" "$(body $API/users/$BPID/profile | jqp 'len(d["badges"])')" "0"
chk "o titular continua vendo, marcada" "$(body $API/users/$BPID/profile -H "Authorization: Bearer $BPT" | jqp '[b["visible"] for b in d["badges"]]')" "[0]"
chk "quem entregou nao muda a visibilidade alheia -> 404" "$(code -X PUT $API/users/me/badges/$UB -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"visible":true}')" "404"
chk "revogar -> 200" "$(code -X DELETE $API/badges/$BID/award/$BPID -H "Authorization: Bearer $OT")" "200"
# A remocao do arquivo acontece depois da resposta do DELETE, entao a conta so
# fecha um instante depois. Esperar a condicao em vez de um segundo fixo.
contar_uploads() { docker compose exec -T backend ls /app/uploads 2>/dev/null | wc -l; }
ANTES_ARQ=$(contar_uploads)
ECAPA=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Capa $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "thumbnail=@$SP/badge.png;type=image/png" | jqp 'd["id"]')
body -X DELETE $API/events/$ECAPA -H "Authorization: Bearer $OT" >/dev/null
espere 15 "a capa sai do disco com o evento" "[ \"\$(contar_uploads)\" -eq $ANTES_ARQ ]"
chk "apagar evento nao deixa a capa no disco" "$(contar_uploads)" "$ANTES_ARQ"

chk "sumiu ate para o titular" "$(body $API/users/$BPID/profile -H "Authorization: Bearer $BPT" | jqp 'len(d["badges"])')" "0"

sec "14. Visibilidade do perfil é escolha do jogador"
PM="privreg$S@t.local"; reg "Reservado" "$PM"; PMT=$(tok "$PM")
PMID=$(body $API/users/me -H "Authorization: Bearer $PMT" | jqp 'd["id"]')
chk "nasce público" "$(body $API/users/me -H "Authorization: Bearer $PMT" | jqp 'd["profile_public"]')" "1"
chk "fechar o perfil" "$(body -X PUT $API/users/me/profile-visibility -H "Authorization: Bearer $PMT" -H 'Content-Type: application/json' -d '{"profile_public":false}' | jqp 'd["profile_public"]')" "0"
chk "anônimo recebe 403, não 404" "$(code $API/users/$PMID/profile)" "403"
chk "e o motivo é traduzível" "$(body $API/users/$PMID/profile | jqp 'd["code"]')" "api.profilePrivate"
chk "o próprio titular continua vendo" "$(code $API/users/$PMID/profile -H "Authorization: Bearer $PMT")" "200"
chk "outra pessoa logada não vê" "$(code $API/users/$PMID/profile -H "Authorization: Bearer $PT")" "403"
chk "token inválido não quebra a rota pública" "$(code $API/users/$PMID/profile -H "Authorization: Bearer lixo.invalido")" "403"
chk "sem login não muda preferência alheia" "$(code -X PUT $API/users/me/profile-visibility -H 'Content-Type: application/json' -d '{"profile_public":false}')" "401"
chk "reabrir volta a responder" "$(body -X PUT $API/users/me/profile-visibility -H "Authorization: Bearer $PMT" -H 'Content-Type: application/json' -d '{"profile_public":true}' >/dev/null; code $API/users/$PMID/profile)" "200"

sec "15. Partner · a dupla joga junta, e a liga conta cada um"
PLG=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga Partner $S\",\"playoff_counts\":true}" | jqp 'd["id"]')
PEV=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Partner $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "tournament_format=partner" -F "playoff_structure=partner2" | jqp 'd["id"]')
body -X PUT $API/events/$PEV -H "Authorization: Bearer $OT" -F "league_id=$PLG" >/dev/null
chk "o formato manda na mesa e no bye" "$(body $API/events/$PEV | jqp '(d["pod_size"], d["allow_byes"])')" "(4, 1)"

# tres duplas de contas: numero impar, para haver bye em toda rodada
for t in Alfa Beta Gama; do
  E1="pa-$t-1-$S@t.local"; E2="pa-$t-2-$S@t.local"
  reg "$t Um" "$E1"; reg "$t Dois" "$E2"
  body -X POST $API/events/$PEV/clans -H "Authorization: Bearer $(tok "$E1")" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$t\",\"emails\":[\"$E1\",\"$E2\"]}" >/dev/null
done
chk "tres duplas, seis jogadores" "$(body $API/events/$PEV | jqp '(len(d["clan_standings"]), len(d["players"]))')" "(3, 6)"

chk "inscricao individual recusada -> 400" "$(code -X POST $API/events/$PEV/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"display_name":"Avulso"}')" "400"
chk "join avulso recusado -> 400" "$(code -X POST $API/events/$PEV/join -H "Authorization: Bearer $PT")" "400"
chk "dupla com tres nomes recusada -> 400" "$(code -X POST $API/events/$PEV/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"name":"Trio","display_names":["a","b","c"]}')" "400"
chk "quem inscreve precisa estar na dupla -> 403" "$(code -X POST $API/events/$PEV/clans -H "Authorization: Bearer $(tok "pa-Alfa-1-$S@t.local")" -H 'Content-Type: application/json' -d "{\"name\":\"Intrusa\",\"emails\":[\"pa-Beta-1-$S@t.local\",\"pa-Beta-2-$S@t.local\"]}")" "403"
chk "playoff de outro formato recusado -> 400" "$(code -X PUT $API/events/$PEV -H "Authorization: Bearer $OT" -F "playoff_structure=top4")" "400"

for _ in 1 2 3; do body -X POST $API/events/$PEV/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $PEV; done
body $API/events/$PEV > $SP/pt1.json
python3 - "$SP" > $SP/pt1.txt <<'PYEOF'
import json, sys, collections
d = json.load(open(sys.argv[1] + '/pt1.json'))
por = {p['id']: p for p in d['players']}
mesas = [m for m in d['pairings'] if m['round_id']]
duplasNaMesa = []
byes = []
for m in mesas:
    s = [m[f'player{i}_id'] for i in (1, 2, 3, 4) if m[f'player{i}_id']]
    times = {por[x]['clan_id'] for x in s}
    if m['result'] == 'bye':
        byes.append(next(iter(times)))
        # o bye leva a dupla inteira
        duplasNaMesa.append(len(s) == 2 and len(times) == 1)
    else:
        # 4 assentos, exatamente 2 duplas, 2 de cada
        cont = collections.Counter(por[x]['clan_id'] for x in s)
        duplasNaMesa.append(len(s) == 4 and len(cont) == 2 and set(cont.values()) == {2})
    # parceiros nos assentos 1-3 e 2-4
    if m['result'] != 'bye':
        duplasNaMesa.append(por[m['player1_id']]['clan_id'] == por[m['player3_id']]['clan_id'])
        duplasNaMesa.append(por[m['player2_id']]['clan_id'] == por[m['player4_id']]['clan_id'])

iguais = all(
    len({p['points'] for p in c['players']}) == 1 and c['points'] == c['players'][0]['points']
    for c in d['clan_standings']
)
soma = sum(c['points'] for c in d['clan_standings'])
print(all(duplasNaMesa), len(set(byes)), len(byes), iguais, soma)
PYEOF
read -r FORMA BYEDIST BYETOT IGUAIS SOMA < $SP/pt1.txt
chk "toda mesa tem duas duplas, parceiros em 1-3 e 2-4" "$FORMA" "True"
chk "tres rodadas impares geram tres byes" "$BYETOT" "3"
chk "e cada dupla folgou uma vez" "$BYEDIST" "3"
chk "cada parceiro vale o mesmo que a dupla, nunca o dobro" "$IGUAIS" "True"
chk "3 vitorias + 3 byes x 3 pontos" "$SOMA" "18"

body $API/leagues/$PLG > $SP/ptlg.json
python3 - "$SP" > $SP/pt2.txt <<'PYEOF'
import json, sys
d = json.load(open(sys.argv[1] + '/pt1.json'))
lg = json.load(open(sys.argv[1] + '/ptlg.json'))
ev = {p['user_id']: p['points'] for p in d['players'] if p.get('user_id')}
liga = {r['user_id']: r['points'] for r in lg['standings']}
divergem = [u for u in ev if ev[u] != liga.get(u)]
# os dois de uma mesma dupla levam o mesmo para a liga
porDupla = [sorted(liga.get(p['user_id']) for p in c['players']) for c in d['clan_standings']]
print(len(liga), len(divergem), all(v[0] == v[1] for v in porDupla), sum(liga.values()))
PYEOF
read -r NLIGA NDIV PARES SOMALIGA < $SP/pt2.txt
chk "os seis jogadores entram na liga" "$NLIGA" "6"
chk "liga e evento dizem o mesmo para cada um" "$NDIV" "0"
chk "os dois de cada dupla levam o mesmo" "$PARES" "True"
chk "na liga a dupla rende para os dois: 18 x 2" "$SOMALIGA" "36"

body -X POST $API/events/$PEV/playoffs/start -H "Authorization: Bearer $OT" > $SP/ppo.json
chk "playoff partner2 abre a final" "$(jqp 'd["round"]["playoff_stage"]' < $SP/ppo.json)" "Final"
chk "e a final e uma mesa 2v2" "$(jqp 'len([1 for m in d["pairings"] if m["player4_id"]])' < $SP/ppo.json)" "1"
fecha $PEV
body $API/events/$PEV > $SP/pt3.json
# O card de pareamento marcava o parceiro do vencedor como derrotado enquanto a
# tabela lhe dava os pontos. Quem venceu passou a vir do servidor, assento a
# assento, da mesma funcao que distribui os pontos.
chk "toda mesa decidida devolve dois vencedores" "$(jqp 'str(sorted(len(m.get("winner_ids") or []) for m in d["pairings"] if m["result"] and m["result"]!="bye"))' < $SP/pt1.json)" "[2, 2, 2]"
chk "e os dois de cada mesa sao da mesma dupla" "$(jqp 'str(all(len({[p for p in d["players"] if p["id"]==w][0]["clan_id"] for w in m["winner_ids"]})==1 for m in d["pairings"] if m.get("winner_ids")))' < $SP/pt1.json)" "True"
chk "a final premia os dois parceiros juntos" "$(jqp 'str(all(len({p["points"] for p in c["players"]})==1 for c in d["clan_standings"]))' < $SP/pt3.json)" "True"


sec "16. Partner · os brackets de 4 e 8 duplas, ate a campea"
# partner4 e partner8 existiam no codigo e no seletor sem nunca terem sido
# jogados ate o fim. Aqui o bracket roda etapa por etapa: cada mesa elimina uma
# dupla, a proxima fase e montada com quem sobrou, e a ultima coroa a campea.
BEV=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Bracket $S" -F "game=Magic" \
  -F "date=2026-10-01T19:00:00Z" -F "tournament_format=partner" -F "playoff_structure=partner8" | jqp 'd["id"]')
for i in 1 2 3 4 5 6 7 8; do
  body -X POST $API/events/$BEV/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"B$i\",\"display_names\":[\"B${i}a\",\"B${i}b\"]}" >/dev/null
done
# duas rodadas suicas com vencedor determinado pelo nome, para a classificacao
# ser desigual e o cruzamento por seed poder ser conferido
for _ in 1 2; do
  body -X POST $API/events/$BEV/rounds -H "Authorization: Bearer $OT" >/dev/null
  body $API/events/$BEV | python3 -c "
import sys,json
d=json.load(sys.stdin)
por={p['id']:p for p in d['players']}
nome={c['id']:c['name'] for c in d['clan_standings']}
for m in d['pairings']:
    if m['result'] or not m['player2_id']: continue
    a=nome[por[m['player1_id']]['clan_id']]; b=nome[por[m['player2_id']]['clan_id']]
    print(m['id'], 'player1' if len(a)<len(b) or (len(a)==len(b) and a<b) else 'player2')
" > $SP/br.txt
  while read -r pid res; do body -X PUT $API/events/$BEV/pairings/$pid -H "Authorization: Bearer $OT" \
    -H 'Content-Type: application/json' -d "{\"result\":\"$res\"}" >/dev/null; done < $SP/br.txt
done

body $API/events/$BEV > $SP/bantes.json
body -X POST $API/events/$BEV/playoffs/start -H "Authorization: Bearer $OT" >/dev/null
body $API/events/$BEV > $SP/bq.json
chk "partner8 abre as quartas com 4 mesas" "$(jqp '(d["rounds"][-1]["playoff_stage"], len([m for m in d["pairings"] if m["round_id"]==d["rounds"][-1]["id"]]))' < $SP/bq.json)" "('Round of 8', 4)"
python3 - "$SP" > $SP/bseed.txt <<'PYEOF'
import json, sys
SP = sys.argv[1]
a = json.load(open(SP + '/bantes.json')); b = json.load(open(SP + '/bq.json'))
ordem = [c['id'] for c in a['clan_standings']]
por = {p['id']: p for p in b['players']}
r = b['rounds'][-1]
cruz = sorted(
    tuple(sorted((ordem.index(por[m['player1_id']]['clan_id']) + 1,
                  ordem.index(por[m['player2_id']]['clan_id']) + 1)))
    for m in b['pairings'] if m['round_id'] == r['id'])
print(str(cruz) == '[(1, 8), (2, 7), (3, 6), (4, 5)]')
PYEOF
chk "e cruza melhor contra pior: 1x8, 2x7, 3x6, 4x5" "$(cat $SP/bseed.txt)" "True"

# joga o bracket ate o fim, conferindo a forma de cada etapa
ETAPAS=""
for _ in 1 2 3 4; do
  body $API/events/$BEV > $SP/be.json
  E=$(jqp 'd["rounds"][-1]["playoff_stage"] if d["rounds"][-1]["is_playoff"] else ""' < $SP/be.json)
  [ -z "$E" ] && break
  N=$(jqp 'len([m for m in d["pairings"] if m["round_id"]==d["rounds"][-1]["id"]])' < $SP/be.json)
  FORMA=$(jqp 'str(all(len([m["player%d_id"%i] for i in (1,2,3,4) if m["player%d_id"%i]])==4 and [p for p in d["players"] if p["id"]==m["player1_id"]][0]["clan_id"]==[p for p in d["players"] if p["id"]==m["player3_id"]][0]["clan_id"] for m in d["pairings"] if m["round_id"]==d["rounds"][-1]["id"]))' < $SP/be.json)
  ETAPAS="$ETAPAS $E/$N/$FORMA"
  jqp '"\n".join(m["id"] for m in d["pairings"] if m["round_id"]==d["rounds"][-1]["id"] and not m["result"])' < $SP/be.json > $SP/bp.txt
  while read -r pid; do [ -n "$pid" ] && body -X PUT $API/events/$BEV/pairings/$pid -H "Authorization: Bearer $OT" \
    -H 'Content-Type: application/json' -d '{"result":"player1"}' >/dev/null; done < $SP/bp.txt
  body -X POST $API/events/$BEV/rounds -H "Authorization: Bearer $OT" > $SP/badv.json
  grep -q '"champion"' $SP/badv.json && break
done
# `${ETAPAS# }` tira o espaço que a primeira volta do laço deixa à esquerda.
chk "tres etapas, cada uma metade da anterior, todas 2v2" "${ETAPAS# }" "Round of 8/4/True Semifinals/2/True Final/1/True"

body $API/events/$BEV > $SP/bfim.json
chk "o evento termina com uma dupla campea" "$(jqp '(d["status"], d["champion_clan_id"] is not None)' < $SP/bfim.json)" "('completed', True)"
chk "e a invariante vale nas oito duplas ate o fim" "$(jqp 'str(all(len({p["points"] for p in c["players"]})==1 and c["points"]==c["players"][0]["points"] for c in d["clan_standings"]))' < $SP/bfim.json)" "True"

# partner4: o mesmo bracket com metade do campo — semifinais e final
P4=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Bracket4 $S" -F "game=Magic" \
  -F "date=2026-10-01T19:00:00Z" -F "tournament_format=partner" -F "playoff_structure=partner4" | jqp 'd["id"]')
for i in 1 2 3 4; do
  body -X POST $API/events/$P4/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"Q$i\",\"display_names\":[\"Q${i}a\",\"Q${i}b\"]}" >/dev/null
done
for _ in 1 2 3; do
  body -X POST $API/events/$P4/rounds -H "Authorization: Bearer $OT" >/dev/null
  body $API/events/$P4 | python3 -c "
import sys,json
d=json.load(sys.stdin); por={p['id']:p for p in d['players']}; nome={c['id']:c['name'] for c in d['clan_standings']}
for m in d['pairings']:
    if m['result'] or not m['player2_id']: continue
    print(m['id'], 'player1' if nome[por[m['player1_id']]['clan_id']] < nome[por[m['player2_id']]['clan_id']] else 'player2')
" > $SP/p4.txt
  while read -r pid res; do body -X PUT $API/events/$P4/pairings/$pid -H "Authorization: Bearer $OT" \
    -H 'Content-Type: application/json' -d "{\"result\":\"$res\"}" >/dev/null; done < $SP/p4.txt
done
body $API/events/$P4 > $SP/p4a.json
body -X POST $API/events/$P4/playoffs/start -H "Authorization: Bearer $OT" >/dev/null
body $API/events/$P4 > $SP/p4b.json
chk "partner4 abre as semifinais com 2 mesas" "$(jqp '(d["rounds"][-1]["playoff_stage"], len([m for m in d["pairings"] if m["round_id"]==d["rounds"][-1]["id"]]))' < $SP/p4b.json)" "('Semifinals', 2)"
python3 - "$SP" > $SP/p4s.txt <<'PYEOF'
import json, sys
SP = sys.argv[1]
a = json.load(open(SP + '/p4a.json')); b = json.load(open(SP + '/p4b.json'))
ordem = [c['id'] for c in a['clan_standings']]
por = {p['id']: p for p in b['players']}
r = b['rounds'][-1]
cruz = sorted(tuple(sorted((ordem.index(por[m['player1_id']]['clan_id']) + 1,
                            ordem.index(por[m['player2_id']]['clan_id']) + 1)))
              for m in b['pairings'] if m['round_id'] == r['id'])
print(str(cruz) == '[(1, 4), (2, 3)]')
PYEOF
chk "e cruza 1x4 e 2x3" "$(cat $SP/p4s.txt)" "True"
fecha $P4
body -X POST $API/events/$P4/rounds -H "Authorization: Bearer $OT" > $SP/p4f.json
chk "os vencedores das semis fazem a final" "$(jqp '(d["round"]["playoff_stage"], len(d["pairings"]))' < $SP/p4f.json)" "('Final', 1)"
fecha $P4
body -X POST $API/events/$P4/rounds -H "Authorization: Bearer $OT" >/dev/null
chk "e a final encerra com campea" "$(body $API/events/$P4 | jqp '(d["status"], d["champion_clan_id"] is not None)')" "('completed', True)"

# guardas: o playoff escolhido precisa de campo para existir
CURTO=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Curto $S" -F "game=Magic" \
  -F "date=2026-10-01T19:00:00Z" -F "tournament_format=partner" -F "playoff_structure=partner8" | jqp 'd["id"]')
for i in 1 2 3; do
  body -X POST $API/events/$CURTO/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"K$i\",\"display_names\":[\"K${i}a\",\"K${i}b\"]}" >/dev/null
done
body -X POST $API/events/$CURTO/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $CURTO
chk "partner8 com 3 duplas nao abre -> 400" "$(code -X POST $API/events/$CURTO/playoffs/start -H "Authorization: Bearer $OT")" "400"
chk "e o erro diz quantas faltam" "$(body -X POST $API/events/$CURTO/playoffs/start -H "Authorization: Bearer $OT" | jqp 'd["error"]')" "O torneio tem 3 duplas; o playoff escolhido precisa de 8"

# dupla quebrada antes do inicio: barrada na rodada, e com conserto
QEV=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Quebra $S" -F "game=Magic" \
  -F "date=2026-10-01T19:00:00Z" -F "tournament_format=partner" | jqp 'd["id"]')
for c in XX YY; do
  body -X POST $API/events/$QEV/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' \
    -d "{\"name\":\"$c\",\"display_names\":[\"${c}a\",\"${c}b\"]}" >/dev/null
done
QPJ=$(body $API/events/$QEV | jqp '[p["id"] for p in d["players"] if p["display_name"]=="XXa"][0]')
code -X DELETE $API/events/$QEV/players/$QPJ -H "Authorization: Bearer $OT" >/dev/null
chk "dupla incompleta trava a rodada, dizendo qual" "$(body -X POST $API/events/$QEV/rounds -H "Authorization: Bearer $OT" | jqp 'd["error"]')" "A dupla XX tem 1 jogadores; todos precisam ter 2"
QCL=$(body $API/events/$QEV | jqp '[c["id"] for c in d["clan_standings"] if c["name"]=="XX"][0]')
chk "a dupla quebrada pode ser apagada" "$(code -X DELETE $API/events/$QEV/clans/$QCL -H "Authorization: Bearer $OT")" "200"
body -X POST $API/events/$QEV/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"name":"XX","display_names":["XXa","XXb"]}' >/dev/null
chk "e reinscrita, a rodada abre" "$(body -X POST $API/events/$QEV/rounds -H "Authorization: Bearer $OT" | jqp 'len(d["pairings"])')" "1"

# elenco trancado depois do inicio
chk "com o torneio em andamento, nao entra dupla nova -> 400" "$(code -X POST $API/events/$QEV/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"name":"ZZ","display_names":["ZZa","ZZb"]}')" "400"
QP2=$(body $API/events/$QEV | jqp 'd["players"][0]["id"]')
chk "nem sai jogador -> 400" "$(code -X DELETE $API/events/$QEV/players/$QP2 -H "Authorization: Bearer $OT")" "400"


sec "10. Organizar depende de aprovacao do dono"
# O self-service acabou: quem pede e quem decide sao pessoas diferentes, e a
# decisao precisa valer sem ninguem relogar.
mkadmin(){ reg "$2" "$1"; docker compose exec -T mysql mysql -uroot -proot123 manasync \
           -e "UPDATE users SET role='admin' WHERE email='$1';" 2>/dev/null; tok "$1"; }
AE="dono$S@t.local"; AT=$(mkadmin "$AE" "Dono Reg")
RJ="pede$S@t.local"; reg "Pedinte Reg" "$RJ"; RT=$(tok "$RJ")
chk "endpoint antigo de auto-promocao nao existe mais" "$(code -X POST $API/users/me/upgrade-to-organizer -H "Authorization: Bearer $RT")" "404"
chk "jogador nao cria evento" "$(code -X POST $API/events -H "Authorization: Bearer $RT" -F "name=X" -F "game=Magic" -F "date=2026-10-01T19:00:00Z")" "403"
chk "solicita" "$(code -X POST $API/users/me/organizer-request -H "Authorization: Bearer $RT" -H 'Content-Type: application/json' -d '{"justification":"organizo na loja"}')" "201"
chk "dois pedidos pendentes nao existem" "$(code -X POST $API/users/me/organizer-request -H "Authorization: Bearer $RT" -H 'Content-Type: application/json' -d '{}')" "409"
chk "pedir nao promoveu ninguem" "$(body $API/users/me -H "Authorization: Bearer $RT" | jqp 'd["role"]')" "player"
chk "jogador nao enxerga a fila" "$(code $API/admin/organizer-requests -H "Authorization: Bearer $RT")" "403"
RID=$(body $API/admin/organizer-requests -H "Authorization: Bearer $AT" | jqp "[r['id'] for r in d if r['email']=='$RJ'][0]")
chk "a fila mostra a justificativa" "$(body $API/admin/organizer-requests -H "Authorization: Bearer $AT" | jqp "[r['justification'] for r in d if r['email']=='$RJ'][0]")" "organizo na loja"
body -X POST $API/admin/organizer-requests/$RID/reject -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"reason":"jogue antes"}' >/dev/null
chk "decidido nao volta para a fila" "$(code -X POST $API/admin/organizer-requests/$RID/approve -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{}')" "409"
chk "a recusa chega com o motivo" "$(body $API/users/me/organizer-request -H "Authorization: Bearer $RT" | jqp 'd["status"]+"/"+d["reason"]')" "rejected/jogue antes"
chk "recusado pode pedir de novo" "$(code -X POST $API/users/me/organizer-request -H "Authorization: Bearer $RT" -H 'Content-Type: application/json' -d '{}')" "201"
RID2=$(body $API/admin/organizer-requests -H "Authorization: Bearer $AT" | jqp "[r['id'] for r in d if r['email']=='$RJ' and r['status']=='pending'][0]")
chk "aprova" "$(body -X POST $API/admin/organizer-requests/$RID2/approve -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{}' | jqp 'd["role"]')" "organizer"
# O token e o mesmo de antes da aprovacao: o papel sai do banco a cada chamada.
REV=$(body -X POST $API/events -H "Authorization: Bearer $RT" -F "name=Pos aprovacao $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" | jqp 'd.get("id","")')
chk "aprovado cria evento sem relogar" "$([ -n "$REV" ] && echo ok)" "ok"
RUID=$(body $API/users/me -H "Authorization: Bearer $RT" | jqp 'd["id"]')
chk "revogar rebaixa" "$(body -X PUT $API/admin/users/$RUID/role -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"role":"player"}' | jqp 'd["role"]')" "player"
chk "e vale no clique seguinte, com o mesmo token" "$(code -X POST $API/events -H "Authorization: Bearer $RT" -F "name=X" -F "game=Magic" -F "date=2026-10-01T19:00:00Z")" "403"
# Revogar tira a permissao, nao o passado: o evento continua dele, inteiro.
chk "o evento criado continua existindo, e continua dele" "$(body $API/events/$REV | jqp 'd["owner_id"]')" "$RUID"
AUID=$(body $API/users/me -H "Authorization: Bearer $AT" | jqp 'd["id"]')
chk "dono nao mexe no proprio papel" "$(code -X PUT $API/admin/users/$AUID/role -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"role":"player"}')" "400"
chk "papel inexistente -> 400" "$(code -X PUT $API/admin/users/$RUID/role -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"role":"superuser"}')" "400"
chk "admin organiza tambem" "$(code -X POST $API/events -H "Authorization: Bearer $AT" -F "name=Admin organiza $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z")" "201"
chk "o dono foi avisado do pedido" "$(body $API/notifications -H "Authorization: Bearer $AT" | jqp "len([n for n in d if n['code']=='notif.organizerRequested'])>=1")" "True"
chk "e o pedinte, de cada desfecho" "$(body $API/notifications -H "Authorization: Bearer $RT" | jqp "sorted({n['code'] for n in d if n['code'].startswith('notif.organizer')})")" "['notif.organizerApproved', 'notif.organizerRejectedReason', 'notif.organizerRevoked']"


sec "17. Quem sai leva os pontos, e a saida deixa rastro"
# O achado: um jogador terminou as quatro rodadas de uma etapa de liga, com todos
# os resultados confirmados, e sumiu da classificacao e da pontuacao da liga.
# Duas coisas faltavam. A liga descartava os pontos de quem saiu, brigando com o
# proprio perfil do jogador, que os somava. E o banco guardava so o estado atual,
# sem autor nem hora: nao havia como dizer quem tirou a pessoa.
DLG=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga Drop $S\"}" | jqp 'd["id"]')
DEV=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Drop $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "points_win=3" -F "league_id=$DLG" | jqp 'd["id"]')

# Dois jogadores com conta: um vai sair por conta propria, o outro fica.
DSAI="dsai$S@t.local"; reg "Dropante" "$DSAI"; DST=$(tok "$DSAI")
DFIC="dfic$S@t.local"; reg "Ficante" "$DFIC"; DFT=$(tok "$DFIC")
body -X POST $API/events/$DEV/join -H "Authorization: Bearer $DST" >/dev/null
body -X POST $API/events/$DEV/join -H "Authorization: Bearer $DFT" >/dev/null
body -X POST $API/events/$DEV/rounds -H "Authorization: Bearer $OT" >/dev/null

# O dropante ganha a mesa, e so depois sai: e o caso real — o resultado existe.
body $API/events/$DEV > $SP/d1.json
PID_SAI=$(jqp "[p['id'] for p in d['players'] if p['display_name']=='Dropante'][0]" < $SP/d1.json)
MESA=$(jqp "d['pairings'][0]['id']" < $SP/d1.json)
VENC=$(jqp "'player1' if d['pairings'][0]['player1_id']=='$PID_SAI' else 'player2'" < $SP/d1.json)
body -X PUT $API/events/$DEV/pairings/$MESA -H "Authorization: Bearer $OT" \
  -H 'Content-Type: application/json' -d "{\"result\":\"$VENC\"}" >/dev/null
chk "antes de sair, a liga da 3 pontos a ele" \
  "$(body $API/leagues/$DLG | jqp "[r['points'] for r in d['standings'] if r['display_name']=='Dropante'][0]")" "3"

# Sai por conta propria. A inscricao foi pareada, entao e drop, nao exclusao.
chk "sair com mesa jogada e drop, nao exclusao" \
  "$(body -X DELETE $API/events/$DEV/join -H "Authorization: Bearer $DST" | jqp 'd["dropped"]')" "True"
chk "e ele sai da classificacao do evento" \
  "$(body $API/events/$DEV | jqp "[p['status'] for p in d['players'] if p['id']=='$PID_SAI'][0]")" "dropped"

# O ponto do pedido: a liga continua somando o que ele fez ate sair.
chk "a liga preserva os pontos de quem saiu" \
  "$(body $API/leagues/$DLG | jqp "[r['points'] for r in d['standings'] if r['display_name']=='Dropante'][0]")" "3"
chk "e o cartel vai junto" \
  "$(body $API/leagues/$DLG | jqp "[(r['wins'],r['losses']) for r in d['standings'] if r['display_name']=='Dropante'][0]")" "(1, 0)"
# A divergencia que existia: o perfil creditava o que a liga ignorava.
UID_SAI=$(body $API/users/me -H "Authorization: Bearer $DST" | jqp 'd["id"]')
chk "perfil e liga dizem o mesmo cartel" \
  "$(body $API/leagues/$DLG | jqp "[r['wins'] for r in d['standings'] if r['display_name']=='Dropante'][0]") $(body $API/users/$UID_SAI/profile | jqp "d['totals']['wins']")" \
  "1 1"

# O rastro: quem saiu e quem foi tirado sao fatos diferentes.
body $API/events/$DEV/history -H "Authorization: Bearer $OT" > $SP/dh.json
chk "a saida por conta propria fica como 'saiu'" \
  "$(jqp "[h['acao'] for h in d if h['event_player_id']=='$PID_SAI'][0]" < $SP/dh.json)" "saiu"
chk "com o nome de quem agiu" \
  "$(jqp "[h['autor'] for h in d if h['event_player_id']=='$PID_SAI'][0]" < $SP/dh.json)" "Dropante"
chk "e a entrada tambem esta registrada" \
  "$(jqp "sorted(h['acao'] for h in d if h['event_player_id']=='$PID_SAI')" < $SP/dh.json)" "['entrou', 'saiu']"
chk "o historico e fechado: jogador nao le" \
  "$(code $API/events/$DEV/history -H "Authorization: Bearer $DFT")" "403"
chk "e nem anonimo" "$(code $API/events/$DEV/history)" "401"

# Reentrar e so do organizador: o jogador nunca volta sozinho.
chk "quem saiu nao reentra sozinho -> 409" \
  "$(code -X POST $API/events/$DEV/join -H "Authorization: Bearer $DST")" "409"
chk "o organizador traz de volta" \
  "$(body -X PUT $API/events/$DEV/players/$PID_SAI -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"status":"active"}' | jqp 'd["status"]')" "active"
chk "e isso fica como 'restaurado'" \
  "$(body $API/events/$DEV/history -H "Authorization: Bearer $OT" | jqp "[h['acao'] for h in d if h['event_player_id']=='$PID_SAI'][0]")" "restaurado"
# Reativa a inscricao existente, nao cria outra: e o que preserva os resultados.
chk "a mesa dele continua de pe, com o mesmo id" \
  "$(body $API/events/$DEV | jqp "len([p for p in d['pairings'] if '$PID_SAI' in (p['player1_id'],p['player2_id'])])")" "1"
chk "e ele volta para a classificacao com os 3 pontos" \
  "$(body $API/events/$DEV | jqp "[p['points'] for p in d['players'] if p['id']=='$PID_SAI' and p['status']=='active'][0]")" "3"
chk "o jogador foi avisado da volta" \
  "$(body $API/notifications -H "Authorization: Bearer $DST" | jqp "len([n for n in d if n['code']=='notif.playerRestored'])")" "1"

# Tirado pelo organizador: mesmo status final, fato diferente.
chk "o organizador tira" \
  "$(body -X DELETE $API/events/$DEV/players/$PID_SAI -H "Authorization: Bearer $OT" | jqp 'd["dropped"]')" "True"
chk "e isso fica como 'removido', com o organizador como autor" \
  "$(body $API/events/$DEV/history -H "Authorization: Bearer $OT" | jqp "[(h['acao'],h['autor']) for h in d if h['event_player_id']=='$PID_SAI'][0]")" "('removido', 'Reg Final')"

# Inscricao que nunca sentou a mesa e apagada — e o historico tem de sobreviver a ela.
NOVO=$(body -X POST $API/events/$DEV/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"display_name":"Avulso"}' | jqp 'd["id"]')
body -X DELETE $API/events/$DEV/players/$NOVO -H "Authorization: Bearer $OT" >/dev/null
chk "a inscricao apagada sai do elenco" \
  "$(body $API/events/$DEV | jqp "len([p for p in d['players'] if p['id']=='$NOVO'])")" "0"
chk "mas o historico guarda o nome e o que houve" \
  "$(body $API/events/$DEV/history -H "Authorization: Bearer $OT" | jqp "sorted((h['acao'],h['display_name']) for h in d if h['event_player_id']=='$NOVO')")" \
  "[('entrou', 'Avulso'), ('excluido', 'Avulso')]"

# Pendente nunca sentou a mesa: continua fora da pontuacao, com ou sem bonus.
PEV=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Fila $S" -F "game=Magic" -F "date=2026-10-01T19:00:00Z" -F "confirm_players=true" -F "league_id=$DLG" | jqp 'd["id"]')
body -X POST $API/events/$PEV/join -H "Authorization: Bearer $DFT" >/dev/null
chk "pedido na fila nao pontua na liga" \
  "$(body $API/leagues/$DLG | jqp "[r['events_played'] for r in d['standings'] if r['display_name']=='Ficante'][0]")" "1"

sec "18. Buscar, filtrar por liga e ordenar a lista de torneios"
# A home e "Meus eventos" passaram a oferecer os mesmos controles, e o recorte
# dos dois vem da mesma regra no servidor (lib/listaEventos). O que se cobre aqui
# e o que nenhum teste unitario alcanca: que a busca realmente ache o torneio
# pelo nome de quem jogou nele, e que a ordem pedida chegue ao banco.
BLG=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga Busca $S\"}" | jqp 'd["id"]')
# Datas distantes e no futuro: entram na secao dos proximos, e a ordem tem o que ordenar.
BE1=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Busca$S Antigo" -F "game=Magic" -F "date=2030-01-10T19:00:00Z" -F "league_id=$BLG" | jqp 'd["id"]')
BE2=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Busca$S Novo" -F "game=Magic" -F "date=2030-12-20T19:00:00Z" -F "league_id=$BLG" | jqp 'd["id"]')
# Um torneio solto, para "sem liga" ter o que filtrar.
BE3=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Busca$S Solto" -F "game=Magic" -F "date=2030-06-15T19:00:00Z" | jqp 'd["id"]')
# O nome do jogador nao aparece no nome de nenhum torneio: se a busca o achar,
# foi pela inscricao.
body -X POST $API/events/$BE1/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"Nicodemos $S\"}" >/dev/null

chk "busca pelo nome do jogador acha o torneio dele" \
  "$(body --get $API/events --data-urlencode "q=Nicodemos $S" | jqp "[e['id'] for e in d]")" "['$BE1']"
chk "e o nome dele nao esta em nome de torneio nenhum" \
  "$(body --get $API/events --data-urlencode "q=Busca$S" | jqp "any('Nicodemos' in e['name'] for e in d)")" "False"
chk "busca pelo nome da liga acha os torneios dela" \
  "$(body --get $API/events --data-urlencode "q=Liga Busca $S" | jqp "sorted(e['id'] for e in d)")" "$(python3 -c "print(sorted(['$BE1','$BE2']))")"
chk "busca pelo nome do torneio continua achando" \
  "$(body --get $API/events --data-urlencode "q=Busca$S Solto" | jqp "[e['id'] for e in d]")" "['$BE3']"

# Fila de espera: quem pediu para entrar tambem e achado (decisao de produto —
# o historico de quem passou pelo torneio nao depende de aprovacao).
FEV=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Fila$S" -F "game=Magic" -F "date=2030-03-01T19:00:00Z" -F "confirm_players=true" | jqp 'd["id"]')
FJ="fila$S@t.local"; reg "Belchior $S" "$FJ"; FJT=$(tok "$FJ")
body -X POST $API/events/$FEV/join -H "Authorization: Bearer $FJT" >/dev/null
chk "quem esta na fila tambem e achado pelo nome" \
  "$(body --get $API/events --data-urlencode "q=Belchior $S" | jqp "[e['id'] for e in d]")" "['$FEV']"

chk "filtro por liga traz so os torneios dela" \
  "$(body --get $API/events --data-urlencode "league_id=$BLG" | jqp "sorted(e['id'] for e in d)")" "$(python3 -c "print(sorted(['$BE1','$BE2']))")"
chk "a busca desta rodada casa os tres torneios" \
  "$(body --get $API/events --data-urlencode "q=Busca$S" | jqp "len(d)")" "3"
chk "sem liga nao traz torneio de liga" \
  "$(body --get $API/events --data-urlencode "league_id=none" --data-urlencode "q=Busca$S" | jqp "[e['id'] for e in d]")" "['$BE3']"

# A ordem: os mesmos dois torneios, invertidos.
chk "mais antigo primeiro" \
  "$(body --get $API/events --data-urlencode "q=Liga Busca $S" --data-urlencode "sort=data_asc" | jqp "[e['id'] for e in d]")" "['$BE1', '$BE2']"
chk "mais novo primeiro" \
  "$(body --get $API/events --data-urlencode "q=Liga Busca $S" --data-urlencode "sort=data_desc" | jqp "[e['id'] for e in d]")" "['$BE2', '$BE1']"
chk "sem pedir ordem, os proximos comecam pelo mais perto de acontecer" \
  "$(body --get $API/events --data-urlencode "q=Liga Busca $S" | jqp "[e['id'] for e in d]")" "['$BE1', '$BE2']"
# Ordem vem da query string e vai para o ORDER BY: so pode ser um dos dois valores.
chk "ordem desconhecida cai no padrao, em vez de virar erro" \
  "$(code --get $API/events --data-urlencode "sort=e.date; DROP TABLE events")" "200"

# As mesmas tres coisas em "Meus eventos", que e a outra tela.
chk "meus eventos aceita a busca por jogador" \
  "$(body --get $API/events/user/mine -H "Authorization: Bearer $OT" --data-urlencode "q=Nicodemos $S" | jqp "[e['id'] for e in d['owned']]")" "['$BE1']"
chk "meus eventos aceita o filtro por liga" \
  "$(body --get $API/events/user/mine -H "Authorization: Bearer $OT" --data-urlencode "league_id=$BLG" | jqp "sorted(e['id'] for e in d['owned'])")" "$(python3 -c "print(sorted(['$BE1','$BE2']))")"
chk "meus eventos aceita a ordem pedida" \
  "$(body --get $API/events/user/mine -H "Authorization: Bearer $OT" --data-urlencode "q=Liga Busca $S" --data-urlencode "sort=data_asc" | jqp "[e['id'] for e in d['owned']]")" "['$BE1', '$BE2']"
chk "e agora diz de que liga e cada torneio" \
  "$(body --get $API/events/user/mine -H "Authorization: Bearer $OT" --data-urlencode "league_id=$BLG" | jqp "set(e['league_name'] for e in d['owned'])")" "{'Liga Busca $S'}"

sec "19. Um torneio nao se mexe pelo id de outro"
# Achado de revisao de seguranca: tres rotas autorizavam contra o evento da URL e
# depois buscavam a mesa (ou a inscricao) so pelo id. Quem organizava o evento A
# passava o id de um filho do evento B e escrevia nele — e os ids saem do
# GET /events/:id, que e publico, entao nao havia nada a adivinhar.
#
# Os tres casos abaixo sao o exploit original com a expectativa invertida: 404.
VIT=$(mkorg "vit$S@t.local" "Bob Vitima")
ATA=$(mkorg "ata$S@t.local" "Ana Atacante")
VEV=$(body -X POST $API/events -H "Authorization: Bearer $VIT" -F "name=Vitima $S" -F "game=Magic" -F "date=2030-05-01T19:00:00Z" -F "async_draws=true" | jqp 'd["id"]')
for n in V1 V2; do body -X POST $API/events/$VEV/players -H "Authorization: Bearer $VIT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
AEV=$(body -X POST $API/events -H "Authorization: Bearer $ATA" -F "name=Atacante $S" -F "game=Magic" -F "date=2030-05-01T19:00:00Z" | jqp 'd["id"]')
VPID=$(body $API/events/$VEV | jqp 'd["players"][0]["id"]')

chk "inscricao alheia nao e editavel pelo id do meu evento" \
  "$(code -X PUT $API/events/$AEV/players/$VPID -H "Authorization: Bearer $ATA" -H 'Content-Type: application/json' -d '{"status":"dropped"}')" "404"
chk "e o jogador da vitima segue ativo" \
  "$(body $API/events/$VEV | jqp 'd["players"][0]["status"]')" "active"

body -X POST $API/events/$VEV/rounds -H "Authorization: Bearer $VIT" >/dev/null
VPAIR=$(body $API/events/$VEV | jqp 'd["pairings"][0]["id"]')
chk "mesa alheia nao recebe resultado pelo id do meu evento" \
  "$(code -X PUT $API/events/$AEV/pairings/$VPAIR -H "Authorization: Bearer $ATA" -H 'Content-Type: application/json' -d '{"result":"player1"}')" "404"
chk "e a mesa da vitima segue sem resultado" \
  "$(body $API/events/$VEV | jqp 'repr(d["pairings"][0]["result"])')" "None"

# Um resultado pendente de verdade: o proprio jogador reporta. Aqui a vitima
# lanca pelo organizador e volta para pendente pela rota de auto-reporte nao
# existir sem conta — o que importa e o estado, nao como se chegou nele.
body -X PUT $API/events/$VEV/pairings/$VPAIR -H "Authorization: Bearer $VIT" -H 'Content-Type: application/json' -d '{"result":"player1"}' >/dev/null
chk "aprovar mesa alheia pelo id do meu evento -> 404" \
  "$(code -X POST $API/events/$AEV/pairings/$VPAIR/approve -H "Authorization: Bearer $ATA")" "404"

# E o controle: pelo id certo, quem organiza continua podendo.
chk "o dono do torneio continua lancando na propria mesa" \
  "$(code -X PUT $API/events/$VEV/pairings/$VPAIR -H "Authorization: Bearer $VIT" -H 'Content-Type: application/json' -d '{"result":"player2"}')" "200"
chk "e editando a propria inscricao" \
  "$(code -X PUT $API/events/$VEV/players/$VPID -H "Authorization: Bearer $VIT" -H 'Content-Type: application/json' -d '{"deck_name":"Burn"}')" "200"

printf '\n\033[1mRESULTADO: %d ok / %d falhas\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
