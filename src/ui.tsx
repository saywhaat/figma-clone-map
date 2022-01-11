import {
  Button,
  Columns,
  Container,
  render,
  Text,
  TextboxNumeric,
  VerticalSpace,
} from "@create-figma-plugin/ui";
import { emit } from "@create-figma-plugin/utilities";
import { h } from "preact";
import { useLayoutEffect, useCallback, useRef } from "preact/hooks";
import "!mapbox-gl/dist/mapbox-gl.css";
import mapboxgl from "mapbox-gl";
import { pointToTile } from "@mapbox/tilebelt";

mapboxgl.accessToken =
  "pk.eyJ1IjoiZGFrdXpuZWNvdiIsImEiOiJja3kwaGMyYWEwMW8zMnVwbnEyY3JxbndhIn0.I_lSKSbQv8xY9Q5S2ODrGg";

function Plugin() {
  const mapRef = useRef<mapboxgl.Map>();

  useLayoutEffect(() => {
    const map = (mapRef.current = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/outdoors-v11",
      center: [30.41264409674052, 36.54859925757881],
      zoom: 14,
    }));
    map.showTileBoundaries = true;
    map.on("click", ({ lngLat }) => {
      const [x, y, z] = pointToTile(
        lngLat.lng,
        lngLat.lat,
        Math.floor(map.getZoom())
      );
      const features = map
        .queryRenderedFeatures()
        .filter((d: any) => {
          const { _x, _y, _z } = d._vectorTileFeature;
          return _x === x && _y === y && _z === z;
        })
        .map((d: any) => d.toJSON());

      emit("CLONE", [x, y, z], features);
    });
  }, []);

  return <div id="map" style="width: 100vw; height: 100vh"></div>;
}

export default render(Plugin);
