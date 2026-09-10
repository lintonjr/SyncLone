/**
 * Funções puras de leitura de uma mesa.
 *
 * As três abas que mostram mesas — Pareamentos, Resultados e Minha Rodada —
 * fazem as mesmas perguntas: quem senta aqui, esse assento ganhou ou perdeu,
 * como se chama esta rodada. Enquanto tudo vivia num componente só, elas eram
 * métodos privados dele; separadas, precisam de um lugar comum, e este é o
 * lugar. Nada aqui depende de estado, de serviço ou de usuário logado.
 */
import { Pairing, Round } from '../../services/event';

export interface PodSeat {
  id: string;
  name: string;
  slot: string;
}

/** Os assentos ocupados da mesa, na ordem em que se sentam. */
export function podPlayers(p: Pairing): PodSeat[] {
  const seats: PodSeat[] = [];
  if (p.player1_id) seats.push({ id: p.player1_id, name: p.p1_name ?? '?', slot: 'player1' });
  if (p.player2_id) seats.push({ id: p.player2_id, name: p.p2_name ?? '?', slot: 'player2' });
  if (p.player3_id) seats.push({ id: p.player3_id, name: p.p3_name ?? '?', slot: 'player3' });
  if (p.player4_id) seats.push({ id: p.player4_id, name: p.p4_name ?? '?', slot: 'player4' });
  return seats;
}

export function podPlayerResult(p: Pairing, slot: string): 'win' | 'loss' | 'draw' | 'bye' | null {
  if (!p.result) return null;
  if (p.result === 'bye') return 'bye';
  if (p.result === 'draw') return 'draw';
  return p.result === slot ? 'win' : 'loss';
}

/** Placar por games, quando registrado. Só existe em mesa 1v1. */
export function gameScoreLabel(p: Pairing): string | null {
  if (p.p1_games === null || p.p1_games === undefined) return null;
  if (p.p2_games === null || p.p2_games === undefined) return null;
  return `${p.p1_games}×${p.p2_games}`;
}

export function roundLabel(round: Round): string {
  return round.is_playoff ? `🏆 Playoffs — ${round.playoff_stage}` : `Round ${round.round_number}`;
}

/**
 * Rótulo do resultado na visão do organizador. `isOwner` muda a resposta: para
 * quem não organiza, um resultado ainda não aprovado não é resultado.
 */
export function resultLabel(p: Pairing, isOwner: boolean): string {
  if (!p.result) return 'Pending';
  if (p.result_status === 'pending' && !isOwner) return 'Pending Approval';
  const map: Record<string, string> = {
    player1: 'P1 Win',
    player2: 'P2 Win',
    draw: 'Draw',
    bye: 'Bye',
  };
  return map[p.result] ?? p.result;
}

/** O mesmo resultado, dito na primeira pessoa para quem está jogando. */
export function myResultLabel(
  pairing: Pairing,
  myPlayerId: string,
): { label: string; cls: string } {
  if (!pairing.result) return { label: 'Pending', cls: 'result-pending' };
  if (pairing.result === 'bye') return { label: 'Bye (Win)', cls: 'result-win' };
  if (pairing.result === 'draw') return { label: 'Draw', cls: 'result-draw' };
  const iAm1 = pairing.player1_id === myPlayerId;
  const won = (iAm1 && pairing.result === 'player1') || (!iAm1 && pairing.result === 'player2');
  return won ? { label: 'Win', cls: 'result-win' } : { label: 'Loss', cls: 'result-loss' };
}
