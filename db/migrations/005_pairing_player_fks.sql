-- Pairings must not outlive the players they seat.
--
-- Dropping a player used to DELETE the event_players row, leaving every pairing
-- that referenced it pointing at nothing: the table rendered an empty seat and the
-- points that player had already handed out stayed in the standings. The API now
-- marks such a player 'dropped' instead (routes/events.js retirePlayer), and these
-- constraints make the database enforce it.
--
-- Existing orphans are cleared first, or the ALTER can't be applied: a pairing whose
-- player1 is gone has lost its subject entirely and is deleted; a missing podmate in
-- seats 2-4 just empties that seat.

DELETE p FROM pairings p
  LEFT JOIN event_players ep ON ep.id = p.player1_id
  WHERE ep.id IS NULL;

UPDATE pairings p LEFT JOIN event_players ep ON ep.id = p.player2_id
  SET p.player2_id = NULL WHERE p.player2_id IS NOT NULL AND ep.id IS NULL;

UPDATE pairings p LEFT JOIN event_players ep ON ep.id = p.player3_id
  SET p.player3_id = NULL WHERE p.player3_id IS NOT NULL AND ep.id IS NULL;

UPDATE pairings p LEFT JOIN event_players ep ON ep.id = p.player4_id
  SET p.player4_id = NULL WHERE p.player4_id IS NOT NULL AND ep.id IS NULL;

ALTER TABLE pairings
  ADD CONSTRAINT pairings_player1_fk FOREIGN KEY (player1_id) REFERENCES event_players (id),
  ADD CONSTRAINT pairings_player2_fk FOREIGN KEY (player2_id) REFERENCES event_players (id),
  ADD CONSTRAINT pairings_player3_fk FOREIGN KEY (player3_id) REFERENCES event_players (id),
  ADD CONSTRAINT pairings_player4_fk FOREIGN KEY (player4_id) REFERENCES event_players (id);
