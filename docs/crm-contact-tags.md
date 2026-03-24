# CRM: contact_tags & contact_tag_assignments

This document describes the tagging system for ICAN Admin CRM. Tags can be applied to any contact type (volunteer, director, subscriber) and are used for filtering, segmenting, and organizing contacts.

---

## Purpose

Tags provide a flexible, staff-managed labeling system. A contact can have any number of tags. Tags display as colored chips on the contact detail view and can be used as filters on the contacts list.

---

## Table: `contact_tags`

Defines the available tags.

| Column | Type | Required | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | yes | autoincrement | Primary key |
| `tag_name` | TEXT | yes | — | Unique display label (e.g., "At-Risk") |
| `color` | TEXT | yes | `#5E6B52` | Hex color for the tag chip UI |
| `created_at` | DATETIME | yes | CURRENT_TIMESTAMP | When the tag was created |

---

## Table: `contact_tag_assignments`

Maps tags to individual contacts.

| Column | Type | Required | Description |
|---|---|---|---|
| `id` | INTEGER | yes | Primary key |
| `contact_type` | TEXT | yes | `volunteer`, `director`, or `subscriber` |
| `contact_id` | INTEGER | yes | Row ID in the relevant contact table |
| `tag_id` | INTEGER | yes | FK to `contact_tags.id`, cascades on delete |
| `created_at` | DATETIME | yes | When the tag was assigned |

Unique constraint on `(contact_type, contact_id, tag_id)` — no duplicate assignments.

---

## Starter Tags (seeded in migration 008)

| Tag | Color |
|---|---|
| Active | `#4CAF50` (green) |
| At-Risk | `#F44336` (red) |
| New | `#2196F3` (blue) |
| Leadership | `#9C27B0` (purple) |
| Newsletter | `#FF9800` (orange) |
| Seed Library | `#795548` (brown) |
| Volunteer | `#009688` (teal) |
| Board | `#3F51B5` (indigo) |

---

## Routes (already in routes/crm.js)

| Method | Path | Action |
|---|---|---|
| `GET` | `/admin/crm/tags` | List all tags with usage counts |
| `POST` | `/admin/crm/tags` | Create a new tag |
| `POST` | `/admin/crm/tags/:id/delete` | Delete a tag (cascades to all assignments) |
| `POST` | `/admin/crm/contacts/:type/:id/tag` | Assign a tag to a contact |
| `POST` | `/admin/crm/contacts/:type/:id/untag/:tagId` | Remove a tag from a contact |

---

## Example Queries

### All tags with usage count
```sql
SELECT ct.*, COUNT(cta.id) as usage_count
FROM contact_tags ct
LEFT JOIN contact_tag_assignments cta ON ct.id = cta.tag_id
GROUP BY ct.id
ORDER BY ct.tag_name;
```

### All contacts with a specific tag
```sql
SELECT contact_type, contact_id
FROM contact_tag_assignments
WHERE tag_id = 1;
```

### All tags for a specific contact
```sql
SELECT ct.tag_name, ct.color
FROM contact_tags ct
JOIN contact_tag_assignments cta ON ct.id = cta.tag_id
WHERE cta.contact_type = 'volunteer'
  AND cta.contact_id = 1;
```

### Contacts tagged 'At-Risk' across all types
```sql
SELECT cta.contact_type, cta.contact_id
FROM contact_tag_assignments cta
JOIN contact_tags ct ON cta.tag_id = ct.id
WHERE ct.tag_name = 'At-Risk';
```

---

## Migration

Run: `migrations/008-contact-tags.sql`

---

## Next Steps

- [ ] Add tag filtering to the contacts list export/CSV
- [ ] Allow bulk tag assignment from contacts list (checkbox select + tag)
- [ ] Add tag categories (engagement, program, risk) for grouping in the UI
- [ ] Automation hook: trigger action when tag is added (e.g., send email when 'At-Risk' applied)
