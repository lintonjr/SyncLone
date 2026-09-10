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
python3 - <<'PY' > $SP/r2.txt
import json, itertools, collections
SP='/tmp/claude-1001/-home-lintonjunior-projects-CloneManaSync/166b0b75-a7d4-4653-b550-2500fc81e9be/scratchpad'
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

printf '\n\033[1mRESULTADO: %d ok / %d falhas\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
