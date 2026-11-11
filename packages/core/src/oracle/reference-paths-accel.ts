/** Reference paths of the accelerator, power and cooling-ladder faults (REQ-110, ADR-0133). */
import { change, path, type ReferencePath, read, sh } from "./reference-path";

const alarms = read("list_alarms");

export const ACCEL_PATHS = {
  // the GPU that fell off the bus is reset; a job that died on the node is continued
  gpu_xid_error: path(
    [alarms, read("gpu_status")],
    [
      change("gpu_reset", { server: "{node}", gpu: "{target}" }),
      alarms,
      change("job_resume", { job: "{target}" }, "alarm:job_failed"),
    ],
    [read("job_status")],
  ),
  // the node is taken out and the job goes on without it
  nvlink_down: path(
    [alarms, read("gpu_status")],
    [
      change("node_drain", { node: "{node}" }),
      alarms,
      change("job_resume", { job: "{target}" }, "alarm:job_failed"),
    ],
    [read("job_status")],
  ),
  ib_link_flap: path(
    [alarms, read("ib_status"), read("job_status")],
    [
      change("node_drain", { node: "{node}" }),
      // a running job on a node the scheduler would avoid is put back in the queue
      change("job_resume", { job: "{@job_status/jobs/0/id}" }),
    ],
    [read("job_status")],
  ),
  gpu_memory_leak_inference: path(
    [alarms, read("gpu_status")],
    [change("gpu_reset", { server: "{node}", gpu: "{target}" })],
  ),
  job_stuck_checkpoint: path(
    [alarms, read("job_status")],
    [change("job_resume", { job: "{target}" })],
  ),
  mig_misconfig: path(
    [alarms, read("job_status")],
    [change("pool_scale", { pool: "{target}", replicas: "{poolReplicas}" })],
  ),
  // the scheduler is started first, then the dead GPU is reset and the job continued
  scheduler_down: path(
    [alarms, read("job_status")],
    [
      sh("{host}", "systemctl restart slurmctld"),
      change("gpu_reset", { server: "{node}", gpu: "{target}" }, "alarm:gpu_down"),
      change("job_resume", { job: "{@job_status/jobs/0/id}" }),
    ],
  ),
  utility_feed_loss: path(
    [alarms, read("substation_status", { substation: "{target}" })],
    [change("transfer_feed", { substation: "{target}", feed: 2 })],
  ),
  cdu_pump_failure: path(
    [alarms, read("cdu_status")],
    [change("cdu_pump_switch", { cdu: "{target}" })],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;

export const ACCEL_VARIANTS = {
  // every server of the rack gets its share of the limit
  "power-cap-rack-limit": path(
    [alarms, read("power_cap_status")],
    [change("set_power_cap", { server: "{target}", watts: "{rackShare}" }, "critical")],
  ),
  // the cap slows the heat; the cooling itself is the facility team's
  "power-cap-cooling-short": path(
    [alarms, read("cooling_status"), read("power_cap_status")],
    [change("set_power_cap", { server: "{target}", watts: "{lowCap}" }, "critical")],
  ),
} as const satisfies Partial<Record<string, ReferencePath>>;
