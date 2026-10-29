/**
 * Checks for light racks (REQ-049): a rack that stands for its servers by count has to add up. The
 * numbers must be well formed, the model a server that fits how the rack is cooled, the servers must
 * fit in the rack, and the rack must not also hold devices of its own.
 */
import type { Catalog } from "@terrarium/core/catalog";
import { withJosa } from "@terrarium/core/kernel";
import { bulkOf, bulkUnits } from "./bulk";
import { rackUnits } from "./geometry";
import type { BlueprintIndex } from "./graph";
import type { Issue } from "./validate";
import { fitProblem } from "./validate-campus";

const problem = (
  severity: Issue["severity"],
  code: string,
  message: string,
  fix: string,
  entityId: string,
): Issue => ({ severity, code, message, fix, entityId });

function modelIssues(rack: { id: string; name: string }, catalog: Catalog, modelId: string) {
  if (!catalog.has(modelId) || catalog.get(modelId).kind !== "server")
    return [
      problem(
        "error",
        "W051",
        `${withJosa(rack.name, "은")} 서버가 아닌 모델 '${modelId}'로 채워져 있다`,
        "카탈로그에 있는 서버 모델을 고른다.",
        rack.id,
      ),
    ];
  return [];
}

export function checkLightRacks(index: BlueprintIndex, catalog: Catalog): Issue[] {
  const out: Issue[] = [];
  for (const rack of index.ofKind("rack")) {
    if (rack.props.bulk !== true) continue;
    const light = bulkOf(rack);
    if (!light) {
      out.push(
        problem(
          "error",
          "W050",
          `${withJosa(rack.name, "은")} 묶음 랙인데 서버 수·모델·사용률 값이 맞지 않다`,
          "서버 수는 0 이상의 정수, 모델은 서버 모델, 사용률은 0~1로 둔다.",
          rack.id,
        ),
      );
      continue;
    }
    const wrongModel = modelIssues(rack, catalog, light.modelId);
    out.push(...wrongModel);
    if (index.childrenOf(rack.id).length > 0)
      out.push(
        problem(
          "error",
          "W053",
          `${withJosa(rack.name, "은")} 묶음 랙인데 장비도 직접 들고 있다`,
          "장비를 빼거나 묶음 표시를 지운다.",
          rack.id,
        ),
      );
    if (wrongModel.length > 0) continue;
    const server = catalog.getOf(light.modelId, "server");
    const units = rackUnits(rack, catalog);
    if (bulkUnits(light, server) > units)
      out.push(
        problem(
          "error",
          "W052",
          `${withJosa(rack.name, "은")} 서버 ${light.servers}대(${bulkUnits(light, server)}U)가 랙 ${units}U에 들어가지 않는다`,
          "서버 수를 줄이거나 더 높은 랙을 쓴다.",
          rack.id,
        ),
      );
    const rackModel = rack.modelId && catalog.has(rack.modelId) ? catalog.get(rack.modelId) : null;
    const misfit = fitProblem(
      server.cooling,
      rackModel?.kind === "rack" ? rackModel.cooling : "air",
    );
    if (misfit)
      out.push(
        problem(
          "error",
          "W030",
          `${rack.name}의 서버는 ${misfit}`,
          "냉각 방식이 맞는 랙에 둔다.",
          rack.id,
        ),
      );
    if (index.outgoing(rack.id, "power").length === 0)
      out.push(
        problem(
          "warning",
          "W054",
          `${withJosa(rack.name, "은")} 전원 공급처가 없다`,
          "분전반이나 PDU에 연결한다.",
          rack.id,
        ),
      );
  }
  return out;
}
