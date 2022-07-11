import {
  decodeAddress,
  encodeAddress,
  evmToAddress,
  isAddress,
} from "@polkadot/util-crypto";

export function getSS58AddressForChain(
  address: string,
  chainId: string
): [boolean, string] {
  const chainIdPrefix = {
    0: 2, //kusama
    2023: 1285, //moonriver
    2000: 8, //karurar
    2090: 10041, //basilisk
  };
  if (!isAddress(address)) {
    return [false, ` - ${address} is not address`];
  }
  if (!chainId.hasOwnProperty(chainId)) {
    return [false, ` - unsupported chain ID: ${chainId}`];
  }
  const addressByteLength = decodeAddress(address).byteLength;
  if (addressByteLength == 32) {
    return [true, encodeAddress(address, chainIdPrefix[chainId])];
  } else if (addressByteLength == 20) {
    return [true, evmToAddress(address, chainIdPrefix[chainId])];
  } else {
    return [false, " - unknown address format"];
  }
}
