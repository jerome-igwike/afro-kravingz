# Afro Kravings Christmas — delivery outcomes

## Event landing experience
- [x] The public website presents Afro Kravings Christmas in a polished, responsive light theme with a clear event headline, event details, and calls to action that work on mobile and desktop.

## Buffet RSVP capture
- [x] Visitors can submit their name and email to join the Christmas buffet without signing in.
- [x] A successful submission shows a clear buffet RSVP confirmation and prevents accidental duplicate submissions for the same email.

## Account access
- [x] Visitors can use the supplied Manus OAuth flow to sign in and sign out.
- [x] The page shows logged-out and signed-in states without inventing a development-only user.

## Buffet pass reservation and attendee area
- [x] Signed-in users can reserve the Christmas buffet pass from the site.
- [x] A signed-in area shows the attendee name, email, reservation status, ticket ID, QR entry code, and a way to download the ticket again.
- [x] Repeated reservation attempts for the same user return the existing reservation rather than creating duplicate QR tickets.

## Personalized QR entry ticket
- [x] After a reservation, the site shows a confirmation state with a downloadable QR ticket populated with the attendee details, Afro Kravings event/company details, event date/location copy, and a unique ticket ID encoded into the QR code.

## Managed runtime requirements
- [x] `GET /manus-routes.json` returns the complete page route manifest.
- [x] The app passes TypeScript checks and starts on the configured port.
