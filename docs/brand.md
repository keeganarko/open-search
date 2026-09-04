# Voyager icon

A black rocket on a white field: a pointed nose, one round window, two fins,
and a small flame. Keep it flat, monochrome, and upright.

The source is [`resources/voyager-mark.svg`](../resources/voyager-mark.svg).
The app UI and README use that vector. Desktop builds use the generated PNG
and ICO files; the ICO contains nine sizes from 16 to 256 pixels.

After editing the vector, regenerate the desktop assets from a graphical
development session with the project's dependencies installed:

```sh
node scripts/generate-icons.cjs
```

Check the result at 16 and 32 pixels before committing. Keep the white field
in dark mode, and leave clear space around the rocket. Avoid gradients,
shadows inside the icon, or extra details that disappear at small sizes.

The portfolio uses a copy of the same SVG. Refresh its Voyager recording when
the visible application branding changes.
