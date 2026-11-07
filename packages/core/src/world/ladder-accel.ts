/**
 * The accelerator ladder (REQ-107, ADR-0130): from no GPU to a liquid-cooled pod. Every choice is modelled: the faults it makes
 * possible are the ones the physics of the accelerator layer (physics/accel.ts) can raise on what the choice builds.
 */
import type { ChipMech } from "./ladder";
import { at, c } from "./ladder-kit";

const LEAF_SPINE = at("network", "net-leaf-spine");

export const ACCEL_CHIPS: readonly ChipMech[] = [
  c("accel", "gpu-none", {}),
  c("accel", "gpu-per-server", {
    build: {
      accel: {
        mode: "server",
        servers: 2,
        spares: 0,
        gpusPerServer: 4,
        scheduler: false,
        job: false,
        pool: true,
        mig: false,
      },
    },
    stops: ["gpu_xid_error", "gpu_memory_leak_inference", "gpu_thermal_throttle", "nvlink_down"],
    slows: [],
    costM: 270,
  }),
  c("accel", "gpu-serving-pool", {
    build: {
      accel: {
        mode: "pool",
        servers: 4,
        spares: 0,
        gpusPerServer: 8,
        scheduler: false,
        job: false,
        pool: true,
        mig: true,
      },
    },
    stops: [],
    slows: [
      "gpu_xid_error",
      "gpu_memory_leak_inference",
      "gpu_thermal_throttle",
      "mig_misconfig",
      "nvlink_down",
    ],
    costM: 1600,
  }),
  c("accel", "gpu-training-cluster", {
    requires: [LEAF_SPINE],
    pointlessWith: [
      {
        layer: "cooling",
        chip: "cool-n",
        note: "학습 클러스터는 한 번 데우면 서버룸이 못 버텨요. 냉방 여유가 없으면 GPU가 먼저 클럭을 깎아요",
      },
    ],
    build: {
      accel: {
        mode: "training",
        servers: 8,
        spares: 2,
        gpusPerServer: 8,
        fabric: "ib",
        scheduler: true,
        job: true,
        pool: false,
        mig: false,
      },
    },
    stops: ["scheduler_down"],
    slows: [
      "gpu_xid_error",
      "nvlink_down",
      "ib_link_flap",
      "gpu_thermal_throttle",
      "job_stuck_checkpoint",
    ],
    costM: 4400,
  }),
  c("accel", "gpu-liquid-pod", {
    requires: [at("cooling", "cool-liquid"), at("power", "pwr-ab"), LEAF_SPINE],
    build: {
      accel: {
        mode: "pod",
        servers: 8,
        spares: 2,
        gpusPerServer: 8,
        fabric: "ib",
        scheduler: true,
        job: true,
        pool: false,
        mig: false,
      },
    },
    stops: ["scheduler_down"],
    slows: [
      "gpu_xid_error",
      "nvlink_down",
      "ib_link_flap",
      "gpu_thermal_throttle",
      "job_stuck_checkpoint",
      "cdu_pump_failure",
      "coolant_leak",
    ],
    costM: 9400,
  }),
];
