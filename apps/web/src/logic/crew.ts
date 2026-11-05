/**
 * The people of a server room, as the 3D view uses them (REQ-074, ADR-0078): who is there and where they
 * stand given what is the matter. Kept in a namespace of its own, apart from `world3d`, so the screen that
 * does not look into a room does not carry it: the view loads this only when the camera goes into one.
 */
export { crewAt, crewOf, NO_TROUBLE, nextWorld, spotOf } from "./world3d/crew";
export { deviceIn, type TroubleInput, troubleKey, troubleOf } from "./world3d/crew-world";
