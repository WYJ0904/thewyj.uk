# Task 19 Design Input Audit

This audit records how the five user-supplied references inform thewyj without copying their brands, assets, wording, or framework code.

## Vesper: Public Brand Stage

Adopted:

- A near-black, high-contrast first viewport with disciplined whitespace.
- A literal `thewyj` brand headline, restrained serif emphasis, precise CTA hierarchy, and a short entrance sequence.
- Subtle border, shine, and metallic cues only where they support hierarchy.
- A public navigation treatment that can expand into structured cards.
- Responsive behavior and a real `prefers-reduced-motion` fallback.

Not adopted:

- Vesper branding, logo, copy, video, hosted fonts, remote assets, or exact one-screen layout.
- A full-page media background unrelated to thewyj.
- Persistent glass, glow, grain, or decorative effects across product workspaces.

## Superr: Authenticated Product Workspace

Adopted:

- A quiet neutral canvas, white functional surfaces, dark readable type, thin borders, and low elevation.
- A four-pixel spacing foundation and consistent input, button, dialog, and card dimensions.
- Comfortable information density suitable for repeated use.
- Generous whitespace between page regions while keeping dense tables and controls efficient.

Not adopted:

- Children's-brand language, stickers, hand-drawn arrows, product photography, orange marker accents, or playful random rotation.
- Very large editorial type inside compact panels.
- Cream-only or orange-dominated product surfaces.

## CardNav: Main Navigation Interaction

Adopted:

- One compact top bar that opens a grouped navigation surface.
- Clear grouping for start, learning, and work destinations.
- Keyboard Escape handling, focus visibility, click-away close, and a reliable mobile layout.
- CSS transitions using transform, opacity, and bounded height.

Not adopted:

- React, GSAP, per-frame height animation, copied component structure, or dependency growth.
- Animation-heavy navigation inside finance and administrator workflows; those retain fast local tabs and toolbars.

## SplitFlapText: Signature Motion

Adopted:

- One small Hero-only phrase transition cycling through learning, tools, finance, and sharing.
- A fixed footprint to avoid layout shift.
- Intersection-aware execution and reduced-motion disablement.

Not adopted:

- Use in headings, forms, lists, dashboards, statuses, administration, or any other repeated component.
- React springs or a continuous animation while the Hero is off screen.

## AccordionGallery: Core Capability Presentation

Adopted:

- A desktop expanding gallery with click, focus, and fine-pointer hover support.
- A stacked touch-first accordion below the desktop breakpoint.
- Real thewyj interface content for learning, tools, finance, sharing, and account capabilities.
- Arrow-key, Home, and End navigation between triggers.

Not adopted:

- Stock scenery, remote images, dramatic parallax, 3D tilt, grayscale reveal, or hover-only discovery.
- Equal treatment of every catalog item; the gallery presents product capabilities, not the entire tool directory.

## Shared Product Direction

The public page is the brand stage; authenticated pages are the product workspace. They share the same blue brand color, semantic state colors, typography families, spacing, focus ring, radii, icon sizing, motion timings, and component states. Surface changes are deliberate context changes, not separate brands.

The implementation uses native HTML, CSS, and JavaScript. It introduces no front-end framework, animation library, remote font, or remote visual dependency.
