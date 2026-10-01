import { createSurfaceData } from './ProceduralSurfaces';
const surfaces = Array.from({ length: 5 }, (_, index) => createSurfaceData(index));
postMessage(surfaces, { transfer: surfaces.flatMap(surface => [surface.color.buffer, surface.normal.buffer, surface.surface.buffer]) });
