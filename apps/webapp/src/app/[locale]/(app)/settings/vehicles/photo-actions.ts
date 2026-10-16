"use server";
import { Effect } from "effect";
import { runServerActionSafe } from "@/lib/effect/result";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { vehiclePhotosActor } from "@/lib/organization/vehicles/vehicle-photo-actor";
import { listPhotos, initiatePhotoUpload } from "@/lib/organization/vehicles/vehicle-photos";
export async function listVehiclePhotos(vehicleId:string) {
 return runServerActionSafe(Effect.gen(function*(){const actor=yield* vehiclePhotosActor("read"); const service=yield* DatabaseService; return yield* service.query("vehiclePhotos.list",()=>listPhotos(service.db,actor,vehicleId));}));
}
export async function initiateVehiclePhotoUpload(vehicleId:string) {
 return runServerActionSafe(Effect.gen(function*(){const actor=yield* vehiclePhotosActor("upload"); const service=yield* DatabaseService; return yield* service.query("vehiclePhotos.initiate",()=>initiatePhotoUpload(service.db,actor,vehicleId));}));
}
