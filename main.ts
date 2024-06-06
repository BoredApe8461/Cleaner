import { ApiPromise, WsProvider } from "@polkadot/api";
import { SignerOptions, SubmittableExtrinsic } from "@polkadot/api/types";
import { Keyring } from '@polkadot/keyring';
import { KeyringPair } from "@polkadot/keyring/types";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { Region, RegionId } from "coretime-utils";

const cleanup = async () => {
  console.log("Beginning the cleanup 🧹🗑️");

  const keyring = new Keyring({ type: 'sr25519', ss58Format: 42 });
  await cryptoWaitReady();
  const cleaner = keyring.addFromMnemonic('PASTE MNEMONIC HERE');

  const wsCoretimeProvider = new WsProvider(
    "wss://rococo-coretime-rpc.polkadot.io/",
  );
  const wsRelayProvider = new WsProvider("wss://rococo-rpc.polkadot.io/");
  const coretimeApi = await ApiPromise.create({ provider: wsCoretimeProvider });
  const relayApi = await ApiPromise.create({ provider: wsRelayProvider });

  const regions = (await coretimeApi.query.broker.regions.entries()).map(
    (e) => {
        const key = (e[0].toHuman() as any)[0];
        const regionId = {begin: parseHNString(key.begin), core: parseHNString(key.core), mask: key.mask}
        return new Region(regionId, e[1].toJSON() as any);
    },
  );

  const relayHeight = Number((await relayApi.query.system.number()).toJSON());

  let expiredRegions: Array<RegionId> = [];
  for(const region of regions) {
    const consumed = region.consumed({ relayBlockNumber: relayHeight, timeslicePeriod: 80 });
    const expired = consumed >= 1;
    if(expired) {
        expiredRegions.push(region.getRegionId());
    }
  };
  console.log('Number of expired regions: ' + expiredRegions.length);

  for(let i = 0; i < expiredRegions.length; i += 20) {
    // Chunks of 20:
    let calls: any = [];
    for(let j = i; j < i + 20; j++) {
        if(!expiredRegions[j]) break;
        calls.push(coretimeApi.tx.broker.dropRegion(expiredRegions[j]));
    }
    await submitExtrinsic(cleaner, coretimeApi.tx.utility.batch(calls), {});
  }

  console.log("Cleaned up ✨✨✨");
};

cleanup();


export async function submitExtrinsic(
  signer: KeyringPair,
  call: SubmittableExtrinsic<"promise">,
  options: Partial<SignerOptions>
): Promise<void> {
  try {
    return new Promise((resolve, _reject) => {
      const unsub = call.signAndSend(signer, options, (result) => {
        console.log(`Current status is ${result.status}`);
        if (result.status.isInBlock) {
          console.log(`Transaction included at blockHash ${result.status.asInBlock}`);
          // don't wait for finalization.
          unsub.then();
          return resolve();
        } else if (result.status.isFinalized) {
          console.log(`Transaction finalized at blockHash ${result.status.asFinalized}`);
          unsub.then();
          return resolve();
        } else if (result.isError) {
          console.log("Transaction error");
          unsub.then();
          return resolve();
        }
      });
    });
  } catch (e) {
    console.log(e);
  }
}

// parse human readable number string
export const parseHNString = (str: string): number => {
  return parseInt(parseHNStringToString(str));
};

export const parseHNStringToString = (str: string): string => {
  return str.replace(/,/g, '');
};
