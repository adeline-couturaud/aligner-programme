begin;
-- L'administratrice peut enregistrer uniquement ses propres essais.
-- Les conditions d'appartenance, la lecture et les partages restent distincts.
alter policy entries_insert on public.daily_entries
  with check (
    user_id = (select auth.uid())
    and (
      (select private.active_member((select auth.uid())))
      or (select private.is_admin())
    )
  );
alter policy entries_update on public.daily_entries
  using (
    user_id = (select auth.uid())
    and (
      (select private.active_member((select auth.uid())))
      or (select private.is_admin())
    )
  )
  with check (
    user_id = (select auth.uid())
    and (
      (select private.active_member((select auth.uid())))
      or (select private.is_admin())
    )
  );
commit;
