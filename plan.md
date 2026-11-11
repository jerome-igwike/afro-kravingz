# Afro Kravings Christmas — implementation plan

## Scope
Create a polished, responsive light-theme event website for Afro Kravings Christmas Buffet. The public landing page should promote the event and collect buffet RSVPs. A visitor can sign in with the supplied Manus OAuth flow, reserve a buffet entry pass, view the pass in a signed-in area, and download a personalized QR ticket containing attendee details, event/company information, and a unique ticket ID.

The first release intentionally uses a lightweight reservation flow rather than introducing a payment provider that has not been configured. The UI presents the pass price and a clear reservation action; payment integration can be connected later without changing the ticket or account model.

## Implementation approach
- Keep the supplied React/Express/tRPC/Drizzle stack.
- Use the existing Manus OAuth application session and keep the `webdev_app_session` cookie contract intact.
- Add Drizzle tables for buffet RSVP entries, pass reservations, and ticket records. Generate unique IDs server-side and make creation idempotent per user.
- Add public waitlist signup and protected reservation/ticket procedures to the tRPC router.
- Build a single-page event experience with anchor navigation, a sign-in modal/entry point, a buffet RSVP panel, a reservation panel, and an attendee dashboard state.
- Generate a client-side printable/downloadable HTML ticket with a machine-readable QR code encoding the server-generated ticket ID, so the guest can show it at the buffet door and save it as a PDF from the browser without a separate file-storage dependency.
- Serve a static `client/public/manus-routes.json` route manifest for the `/` and `/404` routes.

## Project structure
- `client/src/pages/Home.tsx`: public event landing page, waitlist form, sign-in / reservation / ticket UI.
- `client/src/index.css`: light-theme visual system, responsive layout, editorial event styling, motion.
- `client/src/App.tsx`: routes and application providers.
- `drizzle/schema.ts`: durable users, waitlist, reservation, and ticket tables.
- `server/db.ts`: waitlist and reservation/ticket queries.
- `server/routers.ts`: public and protected tRPC procedures.
- `client/public/manus-routes.json`: route declaration required by the managed preview.
- `app.config.ts`: project logo metadata.

## Design

### Three possible styles
- **Cocoa editorial supper club (0.06):** cream paper, cocoa ink, ember red, and green with oversized serif headlines and ticket-stub details.
- **Minimal winter gallery (0.08):** white space, silver-gray lines, and restrained red accents with a quiet luxury tone.
- **Playful market poster (0.07):** bold blocks, hand-drawn type, and bright ornament-like shapes.

### Chosen style: Afro Kravings supper-club ledger

- **Design Movement:** considered independent design-studio editorial, translated into a warm Afro Kravings event index rather than a restaurant template.
- **Core Principles:** no generic SaaS chrome; let typography and physical marks carry the identity; make the menu feel handled; make every action feel like writing a name into the night’s guest book.
- **Color Philosophy:** ink black and wine burgundy create an intimate after-dark room, cream paper gives the menu a tactile ground, tomato red marks the kitchen’s action stamps, and warm gold reads as candlelight.
- **Layout Paradigm:** a compact utility navigation, text-led event cover, typographic £35 pass marker, indexed menu rows, and a reservation docket rather than a centered marketing grid or photo hero.
- **Signature Elements:** Bodoni Moda display type, DM Mono metadata, numbered utility links, a rotated burgundy pass marker, and a scrolling dish ticker.
- **Interaction Philosophy:** forms are short and confident, CTAs use plain language, and confirmations feel like a small ceremony rather than a system notification. Hover and focus states lift or underline rather than introduce noisy effects.
- **Animation:** restrained hover color shifts, smooth anchor scrolling, and no decorative motion that competes with the event information or ticket flow. Respect reduced-motion preferences.
- **Typography System:** `DM Serif Display` for event headlines and `Manrope` for UI, labels, and body copy. Uppercase micro-labels use wide tracking; ticket metadata uses compact monospace-like spacing.
- **Brand Essence:** a joyful Christmas gathering where Afro-fusion food, music, and people meet — warm, social, and considered.
- **Brand Voice:** warm, direct, and lightly cheeky. Example lines: “Come hungry. Leave glowing.” and “Your seat at the table starts here.”
- **Wordmark & Logo:** a compact cocoa wordmark with a red seal-like “AK” monogram and a small evergreen sprig motif.
- **Signature Brand Color:** ember red `#b44a35`, used as the ownable Afro Kravings accent against parchment and cocoa.

### Event truth from the supplied reference

- Sunday, 20 December 2026 at 1 High Point, New John Street, Bradford BD1 2BA.
- Doors open at 2:00 PM with a welcome spiced Zobo mocktail; the grand buffet opens at 3:00 PM.
- One equal £35 payment per guest; no VIP tiers, no separate tables, and no account/login required.
- The pass covers unlimited access to 14 signature dishes, live Highlife and carols, dessert treats, and clearly labelled Halal/allergen information.
- Children under five attend free with an accompanying adult ticket holder; dress code is Afro chic / smart casual.
