import { on, showUI } from "@create-figma-plugin/utilities";
import { Geometry, Position, Polygon } from "geojson";
import { MapboxGeoJSONFeature, Layer } from "mapbox-gl";
import SphericalMercator from "@mapbox/sphericalmercator";
import { tileToBBOX } from "@mapbox/tilebelt";
import { head, last, groupBy } from "lodash";

const merc = new SphericalMercator({});

function px([lng, lat]: number[]): [number, number] {
  return merc.px([lng, lat], 14);
}

function polygonToVectorNetwork(
  origin: Position,
  polygonCoordinates: Position[][]
): VectorNetwork {
  const vertices: VectorVertex[] = [];
  const segments: VectorSegment[] = [];
  const loops: number[][] = [];

  const [x0, y0] = px(origin);

  polygonCoordinates.forEach((linearRingCoordinates) => {
    const [headLng, headLat] = head(linearRingCoordinates)!;
    const [lastLng, lastLat] = last(linearRingCoordinates)!;
    if (!(headLng === lastLng && headLat === lastLat)) {
      throw "Polygon must be closed";
    }

    const loop: number[] = [];

    linearRingCoordinates.forEach((lngLat, index) => {
      const [x1, y1] = px(lngLat);
      const x = x1 - x0;
      const y = y1 - y0;

      if (index === 0) {
        vertices.push({ x, y });
      } else if (index === linearRingCoordinates.length - 1) {
        const firstVertexIndex =
          vertices.length - linearRingCoordinates.length + 1;
        const lastVertexIndex = vertices.length - 1;
        const segmentIndex =
          segments.push({
            start: lastVertexIndex,
            end: firstVertexIndex,
          }) - 1;
        loop.push(segmentIndex);
      } else {
        const vertexIndex = vertices.push({ x, y }) - 1;
        const segmentIndex =
          segments.push({
            start: vertexIndex - 1,
            end: vertexIndex,
          }) - 1;
        loop.push(segmentIndex);
      }
    });

    loops.push(loop);
  });

  return { vertices, segments, regions: [{ windingRule: "NONZERO", loops }] };
}

function lineStringToVectorNetwork(
  origin: Position,
  lineStringCoordinates: Position[]
): VectorNetwork {
  const vertices: VectorVertex[] = [];
  const segments: VectorSegment[] = [];

  const [x0, y0] = px(origin);

  lineStringCoordinates.forEach((lngLat, index) => {
    const [x1, y1] = px(lngLat);
    const x = x1 - x0;
    const y = y1 - y0;

    if (index === 0) {
      vertices.push({ x, y });
    } else {
      const vertexIndex = vertices.push({ x, y }) - 1;
      segments.push({
        start: vertexIndex - 1,
        end: vertexIndex,
      });
    }
  });

  return { vertices, segments };
}

function handleStroke(layer: Layer, node: MinimalStrokesMixin) {
  const lineColor = (layer.paint as any)["line-color"];
  const lineWidth = (layer.paint as any)["line-width"];
  const lineOpacity = (layer.paint as any)["line-opacity"];

  if (lineColor) {
    const { a, ...rgb } = lineColor;
    node.strokes = [{ type: "SOLID", color: rgb, opacity: lineOpacity }];
  } else {
    node.strokes = [];
  }

  if (lineWidth) {
    node.strokeWeight = lineWidth * 4;
  }
}

function handleFill(layer: Layer, node: MinimalFillsMixin) {
  const fillColor = (layer.paint as any)["fill-color"];
  if (fillColor) {
    const { a, ...rgb } = fillColor;
    node.fills = [{ type: "SOLID", color: rgb }];
  }
}

function createLineStringNode(
  origin: Position,
  coordinates: Position[],
  layer: Layer
): VectorNode {
  const result = figma.createVector();
  result.vectorNetwork = lineStringToVectorNetwork(origin, coordinates);
  handleStroke(layer, result);
  return result;
}

function createPolygonNode(
  origin: Position,
  coordinates: Position[][],
  layer: Layer
): VectorNode {
  const result = figma.createVector();
  result.vectorNetwork = polygonToVectorNetwork(origin, coordinates);
  handleStroke(layer, result);
  handleFill(layer, result);
  return result;
}

function createObject(
  origin: number[],
  feature: MapboxGeoJSONFeature
): BaseNode {
  const { geometry, layer } = feature;
  if (geometry.type === "Polygon") {
    const { coordinates } = geometry;
    return createPolygonNode(origin, coordinates, layer);
  } else if (geometry.type === "MultiPolygon") {
    const { coordinates } = geometry;
    const polygonNodes = coordinates.map((d) =>
      createPolygonNode(origin, d, layer)
    );
    return figma.group(polygonNodes, figma.currentPage);
  } else if (geometry.type === "LineString") {
    const { coordinates } = geometry;
    return createLineStringNode(origin, coordinates, layer);
  } else if (geometry.type === "MultiLineString") {
    const { coordinates } = geometry;
    const lineStringNodes = coordinates.map((d) =>
      createLineStringNode(origin, d, layer)
    );
    return figma.group(lineStringNodes, figma.currentPage);
  } else {
    throw "Unsupported geometry type";
  }
}

function createLayers(
  tileOrigin: number[],
  features: MapboxGeoJSONFeature[]
): BaseNode[] {
  const layerGroups = groupBy(features, (d) => d.layer.id);
  return Object.entries(layerGroups).map(([layerId, layerFeatures]) => {
    const objectNodes: BaseNode[] = [];
    layerFeatures.forEach((feature) => {
      if (
        !["Polygon", "MultiPolygon", "LineString", "MultiLineString"].includes(
          feature.geometry.type
        )
      ) {
        return;
      }
      objectNodes.push(createObject(tileOrigin, feature));
    });
    const layerNode = figma.group(objectNodes, figma.currentPage);
    layerNode.name = layerId;
    return layerNode;
  });
}

export default function () {
  on("CLONE", (tile: number[], features: MapboxGeoJSONFeature[]) => {
    const bbox = tileToBBOX(tile);
    const tileOrigin = [bbox[0], bbox[3]];
    const [startX, startY] = px(tileOrigin);
    const [endX, endY] = px([bbox[2], bbox[1]]);
    const boundsNode = figma.createRectangle();
    boundsNode.resize(endX - startX, endY - startY);
    boundsNode.name = "Bounds";
    boundsNode.isMask = true;
    const layerNodes = createLayers(tileOrigin, features.reverse());
    const tileNode = figma.group(
      [...layerNodes, boundsNode],
      figma.currentPage
    );
    tileNode.name = tile.join("/");
  });

  showUI({
    width: 900,
    height: 600,
  });
}
