-- Seed: sample contact_interactions rows
-- Run after 007-contact-interactions migration
-- Uses placeholder IDs; replace with real contact/event IDs from your DB

-- Manual staff note on a volunteer
INSERT INTO contact_interactions
  (contact_type, contact_id, interaction_type, subject, body, channel, direction, staff_user_id)
VALUES
  ('volunteer', 1, 'note', 'Onboarding check-in', 'Called to confirm first shift. Volunteer confirmed attendance and asked about parking.', 'manual', 'outbound', 1);

-- Inbound email from a subscriber
INSERT INTO contact_interactions
  (contact_type, contact_id, interaction_type, subject, body, channel, direction, staff_user_id)
VALUES
  ('subscriber', 5, 'email', 'Question about newsletter', 'Subscriber asked to be removed from weekly digest but stay on event alerts.', 'gmail', 'inbound', 1);

-- Event RSVP logged for a volunteer
INSERT INTO contact_interactions
  (contact_type, contact_id, interaction_type, subject, body, channel, direction, related_event_id, staff_user_id)
VALUES
  ('volunteer', 2, 'event_rsvp', 'RSVP: Spring Garden Cleanup', 'Volunteer confirmed attendance for Spring Garden Cleanup on 2026-04-12.', 'event_system', 'inbound', 3, 1);

-- Phone call with a director
INSERT INTO contact_interactions
  (contact_type, contact_id, interaction_type, subject, body, channel, direction, staff_user_id)
VALUES
  ('director', 1, 'phone', 'Board meeting prep call', 'Discussed agenda items for Q2 board meeting. Director requested updated budget report.', 'manual', 'outbound', 1);

-- System-generated form submission from a subscriber
INSERT INTO contact_interactions
  (contact_type, contact_id, interaction_type, subject, body, channel, direction)
VALUES
  ('subscriber', 8, 'form_submit', 'Volunteer interest form submitted', 'Subscriber submitted the volunteer interest form via the website.', 'website_form', 'inbound');

-- Program-related meeting with a volunteer
INSERT INTO contact_interactions
  (contact_type, contact_id, interaction_type, subject, body, channel, direction, related_program_id, staff_user_id)
VALUES
  ('volunteer', 3, 'meeting', 'Program orientation: Seed Library', 'Attended in-person orientation for Seed Library program. Completed training checklist.', 'manual', 'inbound', 2, 1);
