#!/usr/bin/env bash
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

. "$(dirname "$0")/regressao-lib.sh"
S=$RANDOM$RANDOM
OT=$(mkorg "reg$S@t.local" "Reg Final")
PJ="regp$S@t.local"; reg "Jogador Reg" "$PJ"; PT=$(tok "$PJ")

sec() { printf '\n\033[1m%s\033[0m\n' "$1"; }

sec "1. Autenticação, papéis e validação"
chk "sem token -> 401" "$(code -X POST $API/events -F "name=X" -F "game=Magic" -F "date=2026-10-01")" "401"
chk "jogador não cria evento -> 403" "$(code -X POST $API/events -H "Authorization: Bearer $PT" -F "name=X" -F "game=Magic" -F "date=2026-10-01")" "403"
chk "erro traz código traduzível" "$(body $API/events/00000000-0000-0000-0000-000000000000 | jqp 'd.get("code")')" "api.eventNotFound"
chk "e mantém a frase de fallback" "$(body $API/events/00000000-0000-0000-0000-000000000000 | jqp '"error" in d')" "True"
chk "data inválida -> 400" "$(code -X POST $API/events -H "Authorization: Bearer $OT" -F "name=X" -F "game=Magic" -F "date=31/12/2026")" "400"

sec "2. C-01 · pontos com uma fonte só"
ID=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg1 $S" -F "game=Magic" -F "date=2026-10-01" -F "points_win=3" | jqp 'd["id"]')
for n in P1 P2 P3 P4; do body -X POST $API/events/$ID/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
fecha() { body $API/events/$1 | python3 -c "
import sys,json;d=json.load(sys.stdin)
print('\n'.join(p['id'] for p in d['pairings'] if not p['result']))" > $SP/p.txt
  while read pid; do [ -n "$pid" ] && body -X PUT $API/events/$1/pairings/$pid -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"result":"player1"}' >/dev/null; done < $SP/p.txt; }
body -X POST $API/events/$ID/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $ID
body -X PUT $API/events/$ID -H "Authorization: Bearer $OT" -F "points_win=10" >/dev/null
body -X POST $API/events/$ID/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $ID
body $API/events/$ID > $SP/r1.json
chk "mesmo cartel, mesmo total" "$(jqp 'len({p["points"] for p in d["players"] if p["wins"]==1})' < $SP/r1.json)" "1"
chk "total = 4 vitórias x escala vigente" "$(jqp 'sum(p["points"] for p in d["players"])' < $SP/r1.json)" "40"
chk "coluna points saiu do banco" "$(docker compose exec -T mysql mysql -N -uroot -proot123 manasync -e "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='manasync' AND table_name='event_players' AND column_name='points';" 2>/dev/null)" "0"

sec "3. C-02 · rotação exata de 4 clãs"
CID=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg2 $S" -F "game=Magic" -F "date=2026-10-01" -F "tournament_format=clafronto" -F "pairing_method=swiss-less-repetition" -F "playoff_structure=clan4" | jqp 'd["id"]')
for c in Alfa Beta Gama Delta; do body -X POST $API/events/$CID/clans -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"$c\",\"display_names\":[\"$c 1\",\"$c 2\",\"$c 3\",\"$c 4\"]}" >/dev/null; done
for r in 1 2 3 4; do body -X POST $API/events/$CID/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $CID; done
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
read DIST REP MESMO BYES < $SP/r2.txt
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
read NG NC < $SP/pf.txt
chk "dois assentos pontuaram" "$NG" "2"
chk "e são do mesmo clã" "$NC" "1"

sec "5. C-03 · evento encerrado só reabre"
E3=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg3 $S" -F "game=Magic" -F "date=2026-10-01" | jqp 'd["id"]')
body -X POST $API/events/$E3/finish -H "Authorization: Bearer $OT" >/dev/null
chk "renomear depois do fim -> 400" "$(code -X PUT $API/events/$E3 -H "Authorization: Bearer $OT" -F "name=Novo")" "400"
chk "reabrir -> 200" "$(code -X PUT $API/events/$E3 -H "Authorization: Bearer $OT" -F "status=ongoing")" "200"

sec "6. C-04 · SSE avisa editar e apagar"
(timeout 6 curl -sN "$API/events/$E3/stream" > $SP/sse.txt &); sleep 1
body -X PUT $API/events/$E3 -H "Authorization: Bearer $OT" -F "name=Reg3 editado" >/dev/null; sleep 1
chk "PUT emite update" "$(grep -c 'data: update' $SP/sse.txt)" "1"
body -X DELETE $API/events/$E3 -H "Authorization: Bearer $OT" >/dev/null; sleep 1
chk "DELETE emite deleted" "$(grep -c 'data: deleted' $SP/sse.txt)" "1"

sec "7. Selo de entrada tardia não confunde eliminação com atraso"
E5=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg5 $S" -F "game=Magic" -F "date=2026-10-01" -F "playoff_structure=top4" | jqp 'd["id"]')
for n in A B C D E F G H; do body -X POST $API/events/$E5/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
for r in 1 2; do body -X POST $API/events/$E5/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $E5; done
body -X POST $API/events/$E5/playoffs/start -H "Authorization: Bearer $OT" >/dev/null
body $API/events/$E5 > $SP/r5.json
chk "Top 4 iniciado, mas o suíço continua com 2 rodadas" "$(jqp 'd["swiss_rounds_total"]' < $SP/r5.json)" "2"
chk "ninguém eliminado vira entrada tardia" "$(jqp 'len([p for p in d["players"] if p["swiss_rounds_seated"] < d["swiss_rounds_total"]])' < $SP/r5.json)" "0"
body -X POST $API/events/$E5/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"display_name":"Tardio"}' >/dev/null
chk "mas quem entra depois continua marcado" "$(body $API/events/$E5 | jqp 'len([p for p in d["players"] if p["swiss_rounds_seated"] < d["swiss_rounds_total"]])')" "1"

sec "8. Regras antigas seguem de pé"
E4=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg4 $S" -F "game=Magic" -F "date=2026-10-01" -F "allow_byes=true" -F "confirm_players=true" | jqp 'd["id"]')
body -X POST $API/events/$E4/join -H "Authorization: Bearer $PT" > $SP/j.json
chk "inscrição com aprovação fica pendente" "$(jqp 'd["pending"]' < $SP/j.json)" "True"
PIDP=$(body $API/events/$E4 | jqp '[p["id"] for p in d["players"] if p["status"]=="pending"][0]')
body -X PUT $API/events/$E4/players/$PIDP -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d '{"status":"active"}' >/dev/null
for n in Q1 Q2 Q3 Q4; do body -X POST $API/events/$E4/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
for r in 1 2 3 4 5; do body -X POST $API/events/$E4/rounds -H "Authorization: Bearer $OT" >/dev/null; fecha $E4; done
body $API/events/$E4 > $SP/r4.json
python3 -c "
import json, collections
d=json.load(open('$SP/r4.json'))
n={p['id']:p['display_name'] for p in d['players']}
c=collections.Counter(n[p['player1_id']] for p in d['pairings'] if p['result']=='bye')
print(len(d['rounds']), max(c.values()) if c else 0, len(c))" > $SP/r4.txt
read NR MAXB DISTB < $SP/r4.txt
chk "A-16: 5 rodadas com 5 jogadores" "$NR" "5"
chk "A-16: ninguém tomou bye duas vezes" "$MAXB" "1"
chk "A-16: todos rodaram o bye" "$DISTB" "5"
RID=$(jqp 'd["rounds"][0]["id"]' < $SP/r4.json)
chk "A-17: cronômetro nasce parado" "$(jqp 'd["rounds"][-1]["timer_started_at"] is None' < $SP/r4.json)" "True"
chk "B-01: Clã Fronto trava pod_size" "$(body -X PUT $API/events/$CID -H "Authorization: Bearer $OT" -F "pod_size=2" | jqp 'd["pod_size"]')" "4"
chk "B-02: playoff incoerente -> 400" "$(code -X POST $API/events -H "Authorization: Bearer $OT" -F "name=X $S" -F "game=Magic" -F "date=2026-10-01" -F "playoff_structure=clan4")" "400"
chk "B-03: swiss_rounds_total exposto" "$(jqp '"swiss_rounds_total" in d' < $SP/r4.json)" "True"
chk "B-04: CSV de clãs" "$(body "$API/events/$CID/export?type=clans" -H "Authorization: Bearer $OT" | head -1 | grep -c 'Rank,Clã')" "1"
chk "A-01: upload não-imagem -> 400" "$(printf 'x' > $SP/x.txt; code -X POST $API/events -H "Authorization: Bearer $OT" -F "name=U $S" -F "game=Magic" -F "date=2026-10-01" -F "thumbnail=@$SP/x.txt;type=text/plain")" "400"
chk "apagar Clã Fronto (FK dos clãs) -> 200" "$(code -X DELETE $API/events/$CID -H "Authorization: Bearer $OT")" "200"

sec "9. Perfil público e vinculação de convidado"
E6=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Reg6 $S" -F "game=Magic" -F "date=2026-10-01" -F "allow_byes=true" | jqp 'd["id"]')
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

sec "10. Métricas por liga"
MF="mf$S@t.local"; reg "Multiliga" "$MF"; MFT=$(tok "$MF")
MFID=$(body $API/users/me -H "Authorization: Bearer $MFT" | jqp 'd["id"]')
LA=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga Alfa $S\"}" | jqp 'd["id"]')
LB=$(body -X POST $API/leagues -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"name\":\"Liga Beta $S\"}" | jqp 'd["id"]')
torneio() {
  local extra=""
  [ -n "$3" ] && extra="-F league_id=$3"
  local eid=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=$1 $S" -F "game=MTG" -F "format=$2" -F "date=2026-10-01" -F "allow_byes=true" $extra | jqp 'd["id"]')
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

sec "11. Notificações: código e teto"
NM="nt$S@t.local"; reg "Notificado" "$NM"; NMT=$(tok "$NM")
NMID=$(body $API/users/me -H "Authorization: Bearer $NMT" | jqp 'd["id"]')
ENT=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Notif $S" -F "game=MTG" -F "date=2026-10-01" -F "allow_byes=true" | jqp 'd["id"]')
body -X POST $API/events/$ENT/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"email\":\"$NM\"}" >/dev/null
for n in N1 N2 N3; do body -X POST $API/events/$ENT/players -H "Authorization: Bearer $OT" -H 'Content-Type: application/json' -d "{\"display_name\":\"$n\"}" >/dev/null; done
body -X POST $API/events/$ENT/rounds -H "Authorization: Bearer $OT" >/dev/null
body $API/notifications -H "Authorization: Bearer $NMT" > $SP/nt.json
chk "a notificacao guarda codigo" "$(jqp 'all(n["code"] for n in d)' < $SP/nt.json)" "True"
chk "e nao a frase pronta" "$(jqp 'all(n["message"] is None for n in d)' < $SP/nt.json)" "True"
chk "com os parametros para a tela montar" "$(jqp 'any(n.get("params") for n in d)' < $SP/nt.json)" "True"
chk "o aviso de rodada traz o numero" "$(jqp '[n["params"]["rodada"] for n in d if n["code"]=="notif.roundStarted"][0]' < $SP/nt.json)" "1"

sec "12. Badges"
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
ANTES_ARQ=$(docker compose exec -T backend ls /app/uploads 2>/dev/null | wc -l)
ECAPA=$(body -X POST $API/events -H "Authorization: Bearer $OT" -F "name=Capa $S" -F "game=Magic" -F "date=2026-10-01" -F "thumbnail=@$SP/badge.png;type=image/png" | jqp 'd["id"]')
body -X DELETE $API/events/$ECAPA -H "Authorization: Bearer $OT" >/dev/null; sleep 1
chk "apagar evento nao deixa a capa no disco" "$(docker compose exec -T backend ls /app/uploads 2>/dev/null | wc -l)" "$ANTES_ARQ"

chk "sumiu ate para o titular" "$(body $API/users/$BPID/profile -H "Authorization: Bearer $BPT" | jqp 'len(d["badges"])')" "0"

sec "13. Visibilidade do perfil é escolha do jogador"
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

printf '\n\033[1mRESULTADO: %d ok / %d falhas\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
