import {
  decodeAddress,
  encodeAddress,
  evmToAddress,
} from "@polkadot/util-crypto";

export function getApropriateSS58Address(
  address: string,
  chainId: string
): string {
  const chainIdPrefix = {
    0: 2, //kusama
    2023: 1285, //moonriver
    2000: 8, //karurar
    2090: 10041, //basilisk
  };
  const addressByteLength = decodeAddress(address).byteLength;
  if (addressByteLength == 32) {
    return encodeAddress(address, chainIdPrefix[chainId]);
  } else if (addressByteLength == 20) {
    return evmToAddress(address, chainIdPrefix[chainId]);
  } else {
    return "unknown address format";
  }
}
