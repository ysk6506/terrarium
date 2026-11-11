/**
 * Golden: what the network facade prints for the switches of every matrix world, from what the links say today
 * (REQ-062, REQ-065): per switch the interface list and neighbors (CLI), the BGP, ECMP, EVPN and route text with the
 * running configuration, and the SNMP interface walk; and again for the two ends of an uplink after it is cut. It
 * protects the facade output while links move from switch to switch to port to port (ADR-0169 decision 4).
 * An expectation here may change only through the test-lock amend procedure (ADR-0004), with an ADR that
 * explains why the behaviour of an existing world changed. A red test here means exactly that.
 * Read docs/design-docs/golden-safety-net.md first.
 */
import { describe, expect, test } from "vitest";
import { facadeFingerprints } from "./test-support/golden-facade";
import { goldenWorld } from "./test-support/golden-matrix";

const IAP: Readonly<Record<string, string>> = {
  "hs-dc1-f1-a-r0101-tor/interfaces": "5958:02df714382ff5f1f",
  "hs-dc1-f1-a-r0101-tor/routing": "2500:1cc6309875e00405",
  "hs-dc1-f1-a-r0101-tor/snmp": "24127:1b0453ce4d74c414",
  "hs-dc1-f1-a-r0102-tor/interfaces": "7555:0864eb1161a41a0b",
  "hs-dc1-f1-a-r0102-tor/routing": "4077:13a3fc0479db1d0e",
  "hs-dc1-f1-a-r0102-tor/snmp": "24127:0cbfbd88010ae50e",
  "hs-dc1-f1-a-r0103-tor/interfaces": "7975:0b27c4e5a659ef1e",
  "hs-dc1-f1-a-r0103-tor/routing": "4492:00f8e7df25bdc708",
  "hs-dc1-f1-a-r0103-tor/snmp": "24127:1cfd9bf7e832e816",
  "hs-dc1-f1-a-r0104-tor/interfaces": "7807:0b2f47596d60601d",
  "hs-dc1-f1-a-r0104-tor/routing": "4326:0cd418d27b30ba09",
  "hs-dc1-f1-a-r0104-tor/snmp": "24127:07d64f14a648e605",
  "hs-dc1-f1-a-spine1/interfaces": "5694:1505f2f24860f51e",
  "hs-dc1-f1-a-spine1/routing": "2203:1908918eafd0d21e",
  "hs-dc1-f1-a-spine1/snmp": "21822:02900d030e4b891f",
  "hs-dc1-f1-a-spine2/interfaces": "5694:1baa34cd44884816",
  "hs-dc1-f1-a-spine2/routing": "2203:0dd97b126b21f719",
  "hs-dc1-f1-a-spine2/snmp": "21822:17370f0e4b232a1d",
  "hs-dc1-f1-a-r0101-tor/interfaces@uplink-cut": "5889:01d6161f5f691f11",
  "hs-dc1-f1-a-r0101-tor/routing@uplink-cut": "2500:1cc6309875e00405",
  "hs-dc1-f1-a-r0101-tor/snmp@uplink-cut": "24127:1b0453ce4d74c414",
  "hs-dc1-f1-a-spine1/interfaces@uplink-cut": "5619:16834359061d4f04",
  "hs-dc1-f1-a-spine1/routing@uplink-cut": "2203:1908918eafd0d21e",
  "hs-dc1-f1-a-spine1/snmp@uplink-cut": "21824:10158ea03f4db81f",
};
const CAMPUS: Readonly<Record<string, string>> = {
  "tor-a/interfaces": "6235:1239318c0928310f",
  "tor-a/routing": "3149:18ecd89e021a3a1a",
  "tor-a/snmp": "24111:0a61598f4c48d20d",
};
const SDN: Readonly<Record<string, string>> = {
  "core1/interfaces": "5109:1a6fff8d67747f16",
  "core1/routing": "1701:1fdb3217bf53291a",
  "core1/snmp": "21813:0ff46e82222c3e1b",
  "sp1/interfaces": "5272:0ed108100be5d910",
  "sp1/routing": "1900:17b4a77265f24e0a",
  "sp1/snmp": "21809:0842b893841bb80c",
  "sp2/interfaces": "5272:09f869c86868231b",
  "sp2/routing": "1900:03d730a6effcbf19",
  "sp2/snmp": "21809:12959d50a4016f11",
  "tor-a/interfaces": "6008:1cf241165582ef10",
  "tor-a/routing": "2925:1a82dc5bf2acf805",
  "tor-a/snmp": "24111:14b50ae3f9544306",
  "tor-b/interfaces": "6008:072f15504cd92e04",
  "tor-b/routing": "2855:0a7b782b5d82bc1c",
  "tor-b/snmp": "24111:0935471c260fa10a",
  "sp1/interfaces@uplink-cut": "5197:061728c6b6caff09",
  "sp1/routing@uplink-cut": "1801:1e6c752ce44b9905",
  "sp1/snmp@uplink-cut": "21811:0cd7ac6e2fcfeb12",
  "core1/interfaces@uplink-cut": "5034:0ea1180ba68b0001",
  "core1/routing@uplink-cut": "1596:0793546675608406",
  "core1/snmp@uplink-cut": "21815:165502c4e0c76707",
};
const TRAIN: Readonly<Record<string, string>> = {
  "hs-dc1-f1-a-r0101-tor/interfaces": "5958:02df714382ff5f1f",
  "hs-dc1-f1-a-r0101-tor/routing": "2500:1cc6309875e00405",
  "hs-dc1-f1-a-r0101-tor/snmp": "24127:1b0453ce4d74c414",
  "hs-dc1-f1-a-r0102-tor/interfaces": "7891:14ee8a71dada961b",
  "hs-dc1-f1-a-r0102-tor/routing": "4409:0e8fbe7efa1f090a",
  "hs-dc1-f1-a-r0102-tor/snmp": "24127:0cbfbd88010ae50e",
  "hs-dc1-f1-a-r0103-tor/interfaces": "7639:1878f9b8cd91c616",
  "hs-dc1-f1-a-r0103-tor/routing": "4160:0078845bfa0d0805",
  "hs-dc1-f1-a-r0103-tor/snmp": "24127:1cfd9bf7e832e816",
  "hs-dc1-f1-a-r0104-tor/interfaces": "7387:09ed968df2e70a0f",
  "hs-dc1-f1-a-r0104-tor/routing": "3911:1ebd55b82bd6450a",
  "hs-dc1-f1-a-r0104-tor/snmp": "24127:07d64f14a648e605",
  "hs-dc1-f1-a-r0105-tor/interfaces": "7807:03c17393da06b41b",
  "hs-dc1-f1-a-r0105-tor/routing": "4326:078b301aba388813",
  "hs-dc1-f1-a-r0105-tor/snmp": "24127:0e98b817198db915",
  "hs-dc1-f1-a-r0106-tor/interfaces": "6294:17063e09c186cc1d",
  "hs-dc1-f1-a-r0106-tor/routing": "2832:138077b8236f9706",
  "hs-dc1-f1-a-r0106-tor/snmp": "24127:1337c751878d4703",
  "hs-dc1-f1-a-r0108-tor/interfaces": "6294:1a6b7b117ae32214",
  "hs-dc1-f1-a-r0108-tor/routing": "2832:04c627a92d02ca1d",
  "hs-dc1-f1-a-r0108-tor/snmp": "24127:1b9632be29303e0a",
  "hs-dc1-f1-a-spine1/interfaces": "6195:126ec3d6e975e810",
  "hs-dc1-f1-a-spine1/routing": "2875:086084248407b916",
  "hs-dc1-f1-a-spine1/snmp": "21816:180578e7953cea19",
  "hs-dc1-f1-a-spine2/interfaces": "6195:0ae16884eab9951c",
  "hs-dc1-f1-a-spine2/routing": "2875:1bc31ad4ea35ab06",
  "hs-dc1-f1-a-spine2/snmp": "21816:17c00eca13a8cc06",
  "hs-dc1-f1-a-r0101-tor/interfaces@uplink-cut": "5889:01d6161f5f691f11",
  "hs-dc1-f1-a-r0101-tor/routing@uplink-cut": "2500:1cc6309875e00405",
  "hs-dc1-f1-a-r0101-tor/snmp@uplink-cut": "24127:1b0453ce4d74c414",
  "hs-dc1-f1-a-spine1/interfaces@uplink-cut": "6120:070dadf1e50ee400",
  "hs-dc1-f1-a-spine1/routing@uplink-cut": "2875:086084248407b916",
  "hs-dc1-f1-a-spine1/snmp@uplink-cut": "21818:066d6708e9d11f08",
};
const FABRIC: Readonly<Record<string, string>> = {
  "gsp1/interfaces": "6067:1386dcd42098f012",
  "gsp1/routing": "4391:148ccd41dbe8e51e",
  "gsp1/snmp": "21800:15107cad5dba3418",
  "gsp2/interfaces": "6067:1f4b0a3debcc451e",
  "gsp2/routing": "4395:1df34cba1dc1bc00",
  "gsp2/snmp": "21800:0d6455f34647ef04",
  "rail1/interfaces": "7503:116b513eb4629800",
  "rail1/routing": "3156:0d3a3532b06d601a",
  "rail1/snmp": "24015:05e6c574f114691b",
  "rail2/interfaces": "7414:0cedac4da0cc5e1a",
  "rail2/routing": "3104:1eca8298a22e520f",
  "rail2/snmp": "24015:00a73d7ee39db519",
  "rail3/interfaces": "7414:0067b9e8eb01eb0c",
  "rail3/routing": "3108:1c8a64869eb68e1e",
  "rail3/snmp": "24015:12d2a191b3d4dc03",
  "rail4/interfaces": "7414:1e4ef9cb0204dd14",
  "rail4/routing": "3112:08756d4b1f6b2518",
  "rail4/snmp": "24015:1a1e44018bbcbd05",
  "rail5/interfaces": "7414:11bb168e45147c0f",
  "rail5/routing": "3112:0a681a0ec33c6402",
  "rail5/snmp": "24015:0c14960ff02cff0a",
  "rail6/interfaces": "7414:154f505d9f173915",
  "rail6/routing": "3112:156bd521a7269801",
  "rail6/snmp": "24015:001c1b473dba521a",
  "rail7/interfaces": "7414:1a6f45f983482d11",
  "rail7/routing": "3112:118f6e2685ed581a",
  "rail7/snmp": "24015:047689ae5c5ca804",
  "rail8/interfaces": "7414:0b784b553b376e0e",
  "rail8/routing": "3115:0b622fd8b4301907",
  "rail8/snmp": "24015:10252cc0717c1117",
  "tor-a/interfaces": "5700:1acc76ec1c99a41f",
  "tor-a/routing": "2299:1922b5fdf468a214",
  "tor-a/snmp": "24111:05f7707e53bd0a1d",
  "rail1/interfaces@uplink-cut": "7428:16a4f74ed27b5d10",
  "rail1/routing@uplink-cut": "3036:046bda9d2b3e710a",
  "rail1/snmp@uplink-cut": "24015:05e6c574f114691b",
  "gsp1/interfaces@uplink-cut": "5992:1e68e8ad4d5b6917",
  "gsp1/routing@uplink-cut": "4263:0538b204221eee07",
  "gsp1/snmp@uplink-cut": "21802:0bce3ee9d9684a00",
};

describe("the network facade prints the recorded text for every matrix world [REQ-062] [REQ-065] [REQ-001]", () => {
  test("iap: every switch prints the recorded interfaces, routing and SNMP", () => {
    expect(facadeFingerprints(goldenWorld("iap"))).toEqual(IAP);
  }, 60_000);
  test("campus: every switch prints the recorded interfaces, routing and SNMP", () => {
    expect(facadeFingerprints(goldenWorld("campus"))).toEqual(CAMPUS);
  }, 60_000);
  test("sdn: every switch prints the recorded interfaces, routing and SNMP", () => {
    expect(facadeFingerprints(goldenWorld("sdn"))).toEqual(SDN);
  }, 60_000);
  test("train: every switch prints the recorded interfaces, routing and SNMP", () => {
    expect(facadeFingerprints(goldenWorld("train"))).toEqual(TRAIN);
  }, 60_000);
  test("fabric: every switch prints the recorded interfaces, routing and SNMP", () => {
    expect(facadeFingerprints(goldenWorld("fabric"))).toEqual(FABRIC);
  }, 60_000);
});
