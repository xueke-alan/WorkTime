# Meteocons calendar weather icons

Source: https://meteocons.com/icons/ and https://github.com/basmilius/meteocons

Version: 3.0.0-next.10, fill style, by Bas Milius. MIT license (see LICENSE).
SVG files are upstream assets downloaded from:
`https://cdn.meteocons.com/3.0.0-next.10/{svg|svg-static}/fill/{name}.svg`.

Local customization: cloud gradient colors `#f3f7fe` and `#e6effc` are replaced
with `#74b9ef` and `#398bd2` for visibility on the pale calendar background.
The same palette is used for animated and static variants; other weather elements
and animation definitions are unchanged.

The calendar loads the animated SVGs locally using images, without a player or
external requests. Static variants respect the reduced-motion preference.
