const terrainCredits={
  ea:'Environment Agency LiDAR. Contains public sector information licensed under the Open Government Licence v3.0. © Environment Agency copyright and/or database right.',
  usgs:'3DEP elevation data courtesy of the U.S. Geological Survey.',
  gsi1:'Elevation data: Geospatial Information Authority of Japan (GSI). Derived printable model.',
  gsi5:'Elevation data: Geospatial Information Authority of Japan (GSI). Derived printable model.',
  file:'User-provided GeoTIFF; retain the original dataset licence and attribution.',
  mapzen:'Mapzen Terrain Tiles / Tilezen. Regional datasets from USGS, NOAA, Environment Agency, Copernicus EU-DEM, Geoscience Australia, LINZ, Kartverket, INEGI, Canada, Austria and ArcticDEM. Regional licences and required credits: https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  srtm:'Tilezen Skadi elevation composite. Regional datasets and required credits: https://github.com/tilezen/joerd/blob/master/docs/attribution.md'
};
export function attribution(model){return [model.mode==='osm'?'© OpenStreetMap contributors. ODbL. https://www.openstreetmap.org/copyright':'',model.mode==='image'?'User-provided heightmap':terrainCredits[model.elevation?.source]||'',model.elevation?.oceanReference?terrainCredits[model.elevation.oceanReference]:''].filter(Boolean).join('\n');}
