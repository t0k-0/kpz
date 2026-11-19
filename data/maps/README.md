# Slepá mapa KPZ

`world-assignment.json` obsahuje názvy a cílové oblasti pro trenažér slepé mapy. Každá položka má kategorii a jednu nebo více geometrií:

- `point`: bod `[zeměpisná délka, zeměpisná šířka]` s tolerancí `radiusKm`
- `line`: řada bodů s tolerancí `radiusKm`
- `polygon`: uzavřená oblast

Admin editor umí položky a geometrie upravit a stáhnout nový JSON. Protože GitHub Pages nemůže zapisovat přímo do repozitáře, staženým souborem je potřeba nahradit `world-assignment.json` a změnu odeslat přes GitHub Desktop.

`ne_110m_land.geojson` je veřejně dostupná mapa pevniny z projektu Natural Earth. Data Natural Earth jsou public domain: https://www.naturalearthdata.com/about/terms-of-use/
