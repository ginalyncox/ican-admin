-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_garden_harvests_gardener ON garden_harvests(gardener_id);
CREATE INDEX IF NOT EXISTS idx_garden_harvests_season ON garden_harvests(season_id);
CREATE INDEX IF NOT EXISTS idx_garden_harvests_donation_status ON garden_harvests(donation_status);
CREATE INDEX IF NOT EXISTS idx_garden_hours_gardener ON garden_hours(gardener_id);
CREATE INDEX IF NOT EXISTS idx_garden_hours_season ON garden_hours(season_id);
CREATE INDEX IF NOT EXISTS idx_garden_hours_program ON garden_hours(program);
CREATE INDEX IF NOT EXISTS idx_gardeners_status ON gardeners(status);
CREATE INDEX IF NOT EXISTS idx_board_members_status ON board_members(status);
CREATE INDEX IF NOT EXISTS idx_board_members_email ON board_members(email);
CREATE INDEX IF NOT EXISTS idx_program_applications_gardener ON program_applications(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_program_applications_status ON program_applications(status);
CREATE INDEX IF NOT EXISTS idx_submissions_form_type ON submissions(form_type);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_event ON event_rsvps(event_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_gardener ON event_rsvps(gardener_id);
