-- Show manually entered organizations while clearly labeling entries that still need review.
drop policy if exists "food_orgs_read_reviewed" on public.food_rescue_organizations;
create policy "food_orgs_read_reviewed" on public.food_rescue_organizations
  for select to anon, authenticated
  using (verification_status in ('verified','needs_review'));

notify pgrst, 'reload schema';
