import {
  init, RecastBuildContext, FloatArray, IntArray, UnsignedCharArray,
  allocHeightfield, createHeightfield, markWalkableTriangles, rasterizeTriangles,
  filterLowHangingWalkableObstacles, filterLedgeSpans, filterWalkableLowHeightSpans,
  allocCompactHeightfield, buildCompactHeightfield, erodeWalkableArea, buildDistanceField, buildRegions,
  allocContourSet, buildContours, allocPolyMesh, buildPolyMesh, allocPolyMeshDetail, buildPolyMeshDetail,
  NavMeshCreateParams, createNavMeshData, NavMesh, NavMeshParams, Recast
} from '@recast-navigation/core';

export { init };

export function generateSoloNavMesh(positions, indices, options = {}) {
  const c = {
    cs: 4, ch: 2, walkableSlopeAngle: 48, walkableHeight: 35, walkableClimb: 9, walkableRadius: 4,
    maxEdgeLen: 48, maxSimplificationError: 1.3, minRegionArea: 8, mergeRegionArea: 20, maxVertsPerPoly: 6,
    detailSampleDist: 6, detailSampleMaxError: 1, ...options
  };
  const vertexCount = positions.length / 3, triangleCount = indices.length / 3;
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    bmin[k] = Math.min(bmin[k], positions[i + k]); bmax[k] = Math.max(bmax[k], positions[i + k]);
  }
  const width = Math.trunc((bmax[0] - bmin[0]) / c.cs + .5), height = Math.trunc((bmax[2] - bmin[2]) / c.cs + .5);
  const walkableHeight = Math.ceil(c.walkableHeight / c.ch), walkableClimb = Math.floor(c.walkableClimb / c.ch), walkableRadius = Math.ceil(c.walkableRadius / c.cs);
  const maxEdgeLen = Math.trunc(c.maxEdgeLen / c.cs);
  const context = new RecastBuildContext(), verts = new FloatArray(), tris = new IntArray(), areas = new UnsignedCharArray();
  verts.copy(positions); tris.copy(indices); areas.resize(triangleCount);
  const heightfield = allocHeightfield();
  if (!createHeightfield(context, heightfield, width, height, bmin, bmax, c.cs, c.ch)) throw new Error('createHeightfield failed');
  markWalkableTriangles(context, c.walkableSlopeAngle, verts, vertexCount, tris, triangleCount, areas);
  rasterizeTriangles(context, verts, vertexCount, tris, areas, triangleCount, heightfield, walkableClimb);
  filterLowHangingWalkableObstacles(context, walkableClimb, heightfield);
  filterLedgeSpans(context, walkableHeight, walkableClimb, heightfield);
  filterWalkableLowHeightSpans(context, walkableHeight, heightfield);
  const compact = allocCompactHeightfield();
  if (!buildCompactHeightfield(context, walkableHeight, walkableClimb, heightfield, compact)) throw new Error('buildCompactHeightfield failed');
  if (!erodeWalkableArea(context, walkableRadius, compact)) throw new Error('erodeWalkableArea failed');
  if (!buildDistanceField(context, compact)) throw new Error('buildDistanceField failed');
  if (!buildRegions(context, compact, 0, c.minRegionArea, c.mergeRegionArea)) throw new Error('buildRegions failed');
  const contours = allocContourSet();
  if (!buildContours(context, compact, c.maxSimplificationError, maxEdgeLen, contours)) throw new Error('buildContours failed');
  const polyMesh = allocPolyMesh();
  if (!buildPolyMesh(context, contours, c.maxVertsPerPoly, polyMesh)) throw new Error('buildPolyMesh failed');
  const detail = allocPolyMeshDetail();
  if (!buildPolyMeshDetail(context, polyMesh, compact, c.detailSampleDist, c.detailSampleMaxError, detail)) throw new Error('buildPolyMeshDetail failed');
  const polygons = polyMesh.npolys();
  for (let i = 0; i < polygons; i++) { polyMesh.setAreas(i, 0); polyMesh.setFlags(i, 1); }
  const params = new NavMeshCreateParams();
  params.setPolyMeshCreateParams(polyMesh);
  params.setPolyMeshDetailCreateParams(detail);
  params.setWalkableHeight(c.walkableHeight);
  params.setWalkableRadius(c.walkableRadius);
  params.setWalkableClimb(c.walkableClimb);
  params.setCellSize(c.cs);
  params.setCellHeight(c.ch);
  params.setBuildBvTree(true);
  const built = createNavMeshData(params);
  if (!built.success) throw new Error('createNavMeshData failed');
  const navMesh = new NavMesh();
  const maxPolys = 1 << Math.max(4, Math.ceil(Math.log2(polygons + 1)));
  navMesh.initTiled(NavMeshParams.create({ orig: { x: bmin[0], y: bmin[1], z: bmin[2] }, tileWidth: width * c.cs, tileHeight: height * c.cs, maxTiles: 1, maxPolys }));
  const status = navMesh.addTile(built.navMeshData, 1, 0);
  return { navMesh, status, polygons, grid: [width, height] };
}
