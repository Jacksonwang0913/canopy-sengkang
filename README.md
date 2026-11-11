# Canopy — Sengkang Playground Screening

An interactive, image-based screening prototype for AR5958A Group 4. It presents the group’s precomputed SegFormer B2 outputs for 40 Sengkang playground photographs. The map shows 39 supplied coordinate pairs. PG_32 has no supplied coordinates and remains accessible in the register and gallery.

## Open or publish

- **Local preview:** run `python -m http.server 8787` from this directory and open `http://127.0.0.1:8787/`.
- **Offline:** run `python tools/build_offline.py Canopy_Playground_Screening.html`, then open the generated file directly. The standalone HTML includes the photos, model outputs, fonts and map data.
- **GitHub Pages:** push this folder as the repository root. In Settings → Pages, select **Deploy from a branch**, **main**, **/(root)**. The site uses relative paths and requires no build, secrets, tile API, or Python service.

## Workflow

1. Browse the map, search by playground or image ID, and open a record. Switch between the original photo, mask, overlay or swipe view.
2. Compare up to four playgrounds, or select points on the tree and sky plot to open their records.
3. Review the detection, photo quality and coordinates. Review notes on the bundled collection are stored in the current browser. Export CSV or save portable HTML to share an edited copy.
4. Run new inference in Colab using the supplied scripts in `analysis/`, then import the results CSV. Attach the corresponding images by original filename or playground/image ID. The static website displays model outputs and imports files locally.
5. Access the project menu to export results or download a self-contained snapshot. Use **Copy link** for a record on the hosted collection.

The displayed percentages measure visible pixels in the specific photographs. Establish shade coverage and heat exposure through site observations. Photo candidates use the dataset’s tree 25th percentile and sky 75th percentile. Review requirements take precedence when identifying inspection candidates.

## Data and sources

- `data/Sengkang_Playground_Coordinates.csv` is the team’s supplied location table. All 40 original source files matched the SHA-256 values embedded in the supplied analysis export. `data/records.js` preserves the export’s metrics, review metadata and model provenance. `assets/evidence/` contains the 40 photos, 40 masks and 40 overlays extracted from that export. Photo provenance and reuse information are carried forward from the source records.
- The B2 checkpoint used for the supplied outputs is [nvidia/segformer-b2-finetuned-ade-512-512](https://huggingface.co/nvidia/segformer-b2-finetuned-ade-512-512). The four supplied Python scripts include two B0 experiments and two B2 workflows. They are retained for reproducibility and were not rerun to produce this website.
- Roads, waterways, parks and rail geometry in `data/basemap.js` derive from OpenStreetMap, accessed 11 November 2026. The simplified OSM-derived features are available under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).
- Planning-area boundaries derive from [URA Master Plan 2025 Planning Area Boundary (No Sea)](https://data.gov.sg/datasets/d_2cc750190544007400b2cfd5d7f53209/view), accessed 11 November 2026 and made available under the [Singapore Open Data Licence](https://data.gov.sg/open-data-licence). Map labels and displayed extents are for orientation.
- [Geist](https://github.com/vercel/geist-font) is bundled under the [SIL Open Font License](assets/Geist-OFL.txt). The interface draws on the typography and evidence layout in [Vercel’s design guide](https://vercel.com/design.md).
