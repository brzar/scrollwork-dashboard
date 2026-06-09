# Product

## Register

product

## Users

Scrollwork's internal team. Three roles, each with a different job-to-be-done:

- **Founders** (super_admin / admin) open the dashboard in the morning to answer one question: "where do we stand this month?" They want confirmed revenue, in-progress estimates, and a clear bottom line broken out by per-founder split. They tolerate density when it's the cost of fewer clicks.
- **Creators** (creator) sign in to see only their own podcasts. They want streams, downloads, and a believable estimate of what they'll be paid. They use this between recording sessions, not for hours at a stretch.
- **Viewers** (viewer) read-only collaborators on assigned shows: managers, accountants, agencies. They want the same shape of information a creator sees, but never any UI element that would lead them to expect they can edit.

Context: laptop browser, light-room lighting, attention spread across many tabs. Never the only thing on screen.

## Product Purpose

Surface confirmed and estimated podcast revenue from the team's hosting
provider, normalized across creators and split per Scrollwork's revenue-share
formula. Replace the "log in to the provider, hop between five tabs,
copy numbers into a spreadsheet" workflow with one dashboard everyone on
the team can read at a glance.

Success looks like:

- Jonathan opens `/`, knows the day-over-day trend in three seconds, and closes the tab.
- A creator opens `/podcasts/[id]`, sees their YTD income and current-month projection without scrolling.
- An admin closes the books for the month with one glance at `/admin/profit`.

## Brand Personality

Calm operator. Three words: **quiet, precise, exact**.

- **Voice**: declarative, unhyped, second-person rare. "April 2026 confirmed: $484.95." Not "You're crushing it!"
- **Numbers do the talking.** A number on this dashboard is a fact, not a celebration. No green confetti, no fireworks, no animated counters.
- **Decoration is a tell.** Every gradient, shadow, or icon needs to either communicate state or get cut.

## Anti-references

- **YouTube Studio dark + neon.** We borrowed the *delta indicator* pattern (circled arrow + "vs usual" copy) because it's the clearest way to show period-over-period at a glance, but we explicitly reject the gamified energy: no dark mode, no red accents on negative numbers, no oversized hero numbers, no animated subscriber-style counters.
- **Stripe-style decorative chrome.** No backdrop-filter glass, no gradient ink, no decorative drop shadows.
- **Generic SaaS purple-to-blue gradient hero.** The brand color is a single committed purple; it never becomes a gradient.
- **Cluttered Google-Analytics-era density.** Every metric on a page should earn its slot. If two cards say the same thing in different units, one of them goes.

## Design Principles

1. **Numbers are the design.** Tabular numerics, generous whitespace around them, restrained chrome everywhere else. The page is a frame for the data.
2. **One brand color, used sparingly.** Purple (#7C3AED) marks the active state, the primary action, and the brand mark. Everything else is the ink grayscale. If a page has more than three purple elements, two of them are decoration.
3. **Eyebrows are slop.** Tiny uppercase tracked labels above every section ("REVENUE", "LAST 30 DAYS") read as scaffolding, not voice. Use sentence-case headings with weight contrast.
4. **Cards are the lazy answer.** Default to plain sections separated by whitespace and rules. A card is a real boundary (the visualization is a thing you'd point at in conversation) or it goes.
5. **Estimates carry their own marker.** Anything that isn't finalized must be visually distinguishable from anything that is, with no exceptions: lighter color, badge, opacity. Never let an estimated number look the same as a confirmed one.

## Accessibility & Inclusion

- **WCAG 2.1 AA.** Body text 4.5:1 against its background; large text (≥18px or bold ≥14px) 3:1. Verify the muted ink ramp (ink-400 / ink-500) against the body bg before shipping any new page.
- **Keyboard-complete.** Every interactive element reachable by Tab in source order, visible focus ring (the brand-purple 2px outline is already there).
- **Reduced motion.** Honor `prefers-reduced-motion`. The `.animate-rise` entrance is decorative; crossfade or disable it under reduced motion.
- **Number formatting.** Always tabular numerics on currency/count columns so vertical scanning works regardless of glyph width.
