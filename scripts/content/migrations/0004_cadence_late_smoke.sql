-- A post recovered after its original week remains terminal in its original
-- slot, while its trusted smoke timestamp is counted only in the actual week.
alter table content.cadence_attempts drop constraint cadence_attempts_outcome_check;
alter table content.cadence_attempts add constraint cadence_attempts_outcome_check
  check (outcome in ('failed-before-submit','rejected','blocked','error','published','smoked','consumed','late-smoked'));
alter table content.cadence_slots drop constraint cadence_slots_state_check;
alter table content.cadence_slots add constraint cadence_slots_state_check
  check (state in ('ready','attempting','submitted','published','smoked','consumed','late-smoked'));
create index cadence_unresolved_content on content.cadence_attempts(target,week_start_utc,slot_number,ordinal)
  where lane='content' and (outcome is null or outcome in ('published','smoked'));
