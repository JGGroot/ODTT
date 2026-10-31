# ODTT — On Demand Tactical Terrain

Static, free map-to-3D app. Geometry, elevation decoding, tiling, merging and exports run on the visitor's device. No account, API key, compute server or billing integration.

## Run

Use Node 24 and pnpm 11:

```sh
cd browser
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm test` verifies closed terrain meshes, winding, courtyard holes, tile joins, merged dimensions, elevation decoding and export packaging. `pnpm build` creates `dist/`; `pnpm preview` serves that production build. Serve over HTTPS or localhost; opening the HTML directly as a file does not support module workers.

## GitHub Pages

The repository workflow `.github/workflows/browser-pages.yml` tests and builds this directory, then publishes its static output on pushes to `main` or `master`. Set repository **Settings → Pages → Source → GitHub Actions** once. Pull requests run the build and geometry checks without publishing. Relative asset paths support a project URL such as `https://jggroot.github.io/ODTT/`. The workflow needs no secrets or paid services.

## Workflows

- **OSM:** select or draw an area, choose layers, set physical width and tile counts, generate, download STL/3MF or a ZIP of both formats per tile. Buildings respect height/level tags; multipolygon holes and buffered roads are supported. Separate color objects appear in 3MF.
- **Terrain:** choose a source, model spacing, smooth or contour surface, relief range or true scale, then generate. A shared elevation grid keeps adjacent tiles aligned. The merged terrain export rebuilds one closed surface without internal tile walls.
- **OSM with terrain:** enable Use terrain. OSM and elevation downloads start together; features become a single terrain mesh, with layer colors in the 3MF. Thin features are limited by sample spacing.
- **Heightmap:** import PNG/JPG/WebP; image proportions become physical model proportions. Optional inversion and smoothing.
- **Local files:** import georeferenced GeoTIFF (WGS84 geographic, Web Mercator, British National Grid, NAD83 geographic or WGS84 UTM) or OSM XML / Overpass JSON. Imported files stay on the device. OSM imports retain editable area bounds.

## Terrain sources

| Source | Coverage | Native detail |
|---|---|---|
| Environment Agency LiDAR DTM | England | 1 m |
| USGS 3DEP service | United States | Variable, typically 1–30 m |
| GSI LiDAR | Japan, partial coverage | 1 m |
| GSI elevation | Japan | 5 m with 10 m fallback |
| Mapzen Terrain Tiles | Global | Regional composite, variable |
| Skadi | Global | 1 arc-second, approximately 30 m at equator |
| Imported GeoTIFF | File coverage | Original dataset resolution |

Automatic selects regional coverage, with Mapzen fallback. Requested model spacing controls mesh density and elevation sampling; it does not improve the source's native detail. GSI/Mapzen downloads choose zoom for the requested mesh and cap requests to 64 tiles. Native 1 m coverage therefore requires a sufficiently small area and fine model spacing. Mapzen automatically retries lower zooms when high-zoom tiles contain no elevation, keeping the selected bounds unchanged. Elevation tiles are interpolated smoothly. Actual mesh sample spacing appears after generation. British National Grid coordinates use a Helmert transformation rather than OSTN15, so overlay registration can differ by several metres. Elevation datum/date vary by dataset. Missing regions are rejected; gaps below 2% are interpolated.

## Performance and services

Tile construction and layer unions use a reusable pool of WASM workers. Automatic parallelism considers device memory and CPU; up to six workers can be selected. Surface grids cap at 900,000 cells and adapt spacing at that limit. Larger models require more memory, especially colored 3MF XML exports. Use draft spacing first on phones.

OSM queries are serial across two Overpass providers with bounded timeouts and cancellation. HTTP 406/429 waits 30 seconds before fallback. For selections below 0.01 square degrees, a final small-area OSM API download is available; the explicit Small-area download option uses that same bounded path. This is for occasional small extracts, not bulk retrieval. Local OSM files work during service outages. OSM responses cache for 24 hours on the device; PNG elevation tiles also cache locally. Public service CORS/rate limits and availability remain external dependencies. Browsers identify hosted requests with their normal Referer; no proxy is required.

The map offers OpenStreetMap streets and Esri World Imagery satellite tiles. Satellite imagery credit: Esri, Vantor, Earthstar Geographics, and the GIS User Community. Search uses Nominatim only on explicit submission, without autocomplete. Requests send the selected coordinates/search terms to their providers. No analytics or file uploads are included.

## Data credits

OSM © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright). England LiDAR: Environment Agency, [Open Government Licence](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). USGS data: [3DEP](https://www.usgs.gov/3d-elevation-program). Japan: [GSI source specifications](https://maps.gsi.go.jp/development/demtile.html). Global composites: [Tilezen regional licences and credits](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). Exported 3MF metadata and tile manifests retain source attribution and record model transformations. Retain original attribution when publishing imported datasets or derived prints.

## Browser support

A current Chromium, Firefox or Safari browser with module workers, WebAssembly, OffscreenCanvas and AbortSignal.timeout/any. WebGL provides preview; exports still work without it. No SharedArrayBuffer or cross-origin isolation headers are required, so GitHub Pages can serve the complete app.


## GPS track inserts

Import KML (LineString or gx:Track), GPX tracks/routes, TCX activities or GeoJSON lines. Files stay on the device. Multiple track segments remain separate; track altitudes are ignored in favour of the selected elevation dataset. Import fits the area to the route; change the selection or use Fit track afterwards.

Track width and fit clearance use print millimetres. The red insert has the original terrain surface on top and a flat underside. Its matching pocket is slightly wider, using the per-side clearance. The underside is at base + 4 mm when possible; it lowers automatically to leave at least 1.2 mm of insert thickness along low portions, while keeping at least 0.4 mm below the pocket. Increase the base if the terrain cannot support that thickness. No height is added to the route's top.

3MF keeps terrain and the red track as separate objects in their assembled positions. STL exports terrain with the empty pocket. Track ZIP contains the terrain STL, the separate insert STL placed on Z=0 for printing, and an assembled 3MF. Tile ZIP includes separate inserts for each tile crossed by the route. Long routes are simplified at 0.08 mm in print space before buffering. Track cutting adds boolean work to generation and export.

Satellite Labels & POIs overlays Esri reference labels and OSM peaks, saddles, springs, huts, viewpoints, campsites, information points, picnic sites, parking, toilets and drinking water. POIs load for the visible map at zoom 12 or closer, within the OSM small-extract area limit, and can be switched off. Imagery, labels and OSM data need an internet connection; their availability remains provider-dependent.


## Terrain controls and islands

Exaggeration has a 0.5–10× slider, a precise multiplier and 1× / 2× / 3× / 5× / 10× presets. The base is the thickness from the bottom of the model to the lowest land sample, and it stays at the Base setting. Exaggeration scales only the relief above that sample, in both Relief range and True scale modes. For example, 16 mm relief at 3× produces 48 mm of relief on top of the base. Changing exaggeration on an existing terrain model rebuilds from cached elevation, including any track recess and insert.

Area aspect presets are Free, 1:1, 16:9, 4:3, 3:2 and 9:16. Locks use geographic ground dimensions at the selection's middle latitude, rather than raw longitude / latitude spans. Choosing a lock expands the selection around its centre; presets, track fitting, coordinate edits and corner resizing respect it. Drag inside the selection to move it; its latitude and longitude span stay the same, and the corner handles still resize it. Draw area enables one pointer drag with a live rectangle; the opposite corner remains fixed when a ratio is locked. Escape cancels a draw. Mouse and touch pointers are supported.

Flatten ocean clamps elevations at or below 0 m to the model base and preserves this mask through smoothing. Relief is measured from the lowest land sample, which sits on the base. A sea-level sample does not lift the land by its altitude above the sea, so exaggeration does not thicken the block under the valleys. Negative bathymetry stays clamped to that same base and does not compress the land. Water remains a separate blue face material in 3MF. This follows the Python island workflow's sea-level handling. As in that workflow, Skadi SRTM voids are treated as sea level when flattening is on. Missing high-zoom Mapzen tiles still use lower-zoom fallback; they are never blindly converted into a flat ocean. Imported heightmaps do not use ocean flattening because their pixel values do not represent georeferenced elevations.

La Palma is the default area, opening in Terrain mode with Flatten ocean enabled. Santa Maria is also available as a whole-island preset; selecting either island enables Flatten ocean. Native elevation detail still depends on the chosen source and mesh spacing. Browser surface grids cap at 900,000 cells; the whole-area mesh and all tiles share the same elevation samples.

Regional LiDAR and imported GeoTIFF sources can mark ocean as missing data. With Flatten ocean enabled, missing samples are filled at sea level only where the global Mapzen reference also reports sea level or below. Missing land remains subject to the normal gap checks; valid high-resolution land samples remain unchanged. Combined outputs retain both source credits. This coastline reference is limited by the global dataset's native detail.


Terrain colors in the browser
-----------------------------

Choose **Terrain colors** when generating terrain, a heightmap, or OSM with terrain.
Each of the five editable stops (forest, grass, earth, rock and snow) has a color
and starting height in percent of the whole model's relief. Regenerate to apply.

* **Realistic** uses elevation and a configurable rock slope. OSM and ocean face
  colors take precedence. These are artistic colors rather than measured land cover.
* **Layer cutoffs** makes separate closed horizontal material volumes, with
  boundaries rounded to your print layer height. All tiles share the same cutoffs.
  This replaces OSM/ocean face colors and generally reduces changes per layer.
* **Gradient** interpolates the five stops into 4, 8 or 16 discrete materials.
  More colors may mean more swaps and purge waste. Combine materials in the slicer
  to match your AMS slots or tool count.

Export **3MF** to keep materials and the assembled placement of the parts.
Assign each material to a filament/tool in your slicer; face-material support varies
between slicers. Cutoff mode provides closed volumes for material assignment.
STL has no color information. No printer-specific G-code or swap estimate is produced;
check your slicer's preview before printing, especially with variable layer heights.
