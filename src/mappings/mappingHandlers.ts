import { SubstrateExtrinsic, SubstrateEvent } from "@subql/types";
import { XCMTransfer } from "../types";
import { blake2AsU8a, blake2AsHex } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { intructionsFromXcmU8Array } from "../common/instructions-from-xcmp-msg-u8array";
import { parceXcmpInstrustions } from "../common/parce-xcmp-instructions";
import { TextEncoder } from "@polkadot/x-textencoder";
import { getSS58AddressForChain } from "../common/get-ss58-address";
import { parceInterior } from "../common/parce-interior";
// Fill with all ids and move to separate file
const chainIDs = {
  Karura: "2000",
  Moonriver: "2023",
};

export async function handleUmpParaEvent(event: SubstrateEvent): Promise<void> {
  const transfer = XCMTransfer.create({
    id: `${event.block.block.header.number.toNumber()}-${event.idx}`,
    warnings: "",
    assetId: [],
    amount: [],
    toAddress: "",
    toParachainId: "",
  });
  transfer.blockNumber = event.block.block.header.number.toBigInt();
  transfer.timestamp = event.block.timestamp.toISOString();
  transfer.xcmpMessageStatus = "UMP sent";
  transfer.toParachainId = "0";
  const {
    sender,
    currencyId,
    amount,
    dest,
  }: { sender: string; currencyId: any; amount: string; dest: any } =
    event.block.events[event.idx].event.data.toHuman() as any;
  transfer.fromParachainId = (await api.query.parachainInfo.parachainId())
    .toString()
    .replace(/,/g, "");
  transfer.fromAddress = sender;
  transfer.assetId.push(currencyId.OtherReserve);
  transfer.amount.push(amount.replace(/,/g, ""));
  // Extract destination address from XcmpMultilocation
  // no need for chain Id, we know already that it goues to relaychain
  const parceInteriorRes = parceInterior(dest.interior);
  if (typeof parceInteriorRes == "string") {
    transfer.warnings += parceInteriorRes;
  } else {
    transfer.toAddress = parceInteriorRes[1];
  }
  // calculate "custom" hash for UMP due to lack ot the "real" one
  // and I don't know how to get the byte representation of XCMP message
  transfer.xcmpMessageHash = blake2AsHex(
    new Uint8Array([
      ...new TextEncoder().encode(amount),
      ...new TextEncoder().encode(JSON.stringify(dest.interior, undefined)),
    ])
  );

  // calculate SS58 addresses for given chains
  const [ansFrom, addressFrom] = getSS58AddressForChain(
    transfer.fromAddress,
    transfer.fromParachainId
  );
  if (ansFrom) transfer.fromAddressSS58 = addressFrom;

  const [ansTo, addressTo] = getSS58AddressForChain(
    transfer.toAddress,
    transfer.toParachainId
  );
  if (ansTo) transfer.toAddressSS58 = addressTo;

  await transfer.save();
}

export async function handleDmpParaEvent(event: SubstrateEvent): Promise<void> {
  const transfer = XCMTransfer.create({
    id: `${event.block.block.header.number.toNumber()}-${event.idx}`,
    warnings: "",
    assetId: [],
    amount: [],
    toAddress: "",
    toParachainId: "",
    amountTransferred: [],
    assetIdTransferred: [],
    xcmpTransferStatus: [],
  });
  transfer.blockNumber = event.block.block.header.number.toBigInt();
  transfer.timestamp = event.block.timestamp.toISOString();
  transfer.xcmpMessageHash =
    event.block.events[event.idx].event.data[0].toString();
  transfer.xcmpMessageStatus = "DMP received";

  // Search for the horizontal message with the given hash (transfer.xcmpMessageHash)
  // inside the assosiated extrinsic (parachainSystem.setValidationData)
  const dmpParaExtrinsic: any = event.extrinsic.extrinsic;
  dmpParaExtrinsic.method.args[0].downwardMessages.forEach(
    ({ sentAt, msg }) => {
      const messageHash = blake2AsHex(Uint8Array.from(msg));
      if (messageHash == transfer.xcmpMessageHash) {
        // Get readable instructions from byte-array xcmp message
        const instructions = intructionsFromXcmU8Array(msg, api);
        if (typeof instructions == "string") {
          transfer.warnings += instructions;
        } else {
          // Parce instructions and safe relevant info
          parceXcmpInstrustions(instructions, transfer);
          // Calculate SS58 version of address
          const [ans, address] = getSS58AddressForChain(
            transfer.toAddress,
            transfer.toParachainId
          );
          if (ans) {
            transfer.toAddressSS58 = address;
          } else {
            transfer.warnings += address;
          }

          // Save all instructions as an array of JSON,
          // in case detailed information is needed (or parces failed)
          transfer.xcmpInstructions = instructions.map((instruction) =>
            JSON.stringify(instruction, undefined)
          );
        }
      }
    }
  );
  // Find and parce assets.Issued event to confirm assets transder
  // and get the final amount deposited
  const assetsIssueEvents: any[] = event.block.events.filter(
    (el) => el.event.section == "assets" && el.event.method == "Issued"
  );
  assetsIssueEvents.forEach(({ event }) => {
    if (event.toHuman().data.owner.toLowerCase() === transfer.toAddress) {
      transfer.xcmpTransferStatus.push("issued");
      transfer.amountTransferred.push(
        event.toHuman().data.totalSupply.replace(/,/g, "")
      );
      transfer.assetIdTransferred.push(event.toHuman().data.assetId);
    }
  });
  await transfer.save();
}

export async function handleXcmpQueueModule(
  event: SubstrateEvent
): Promise<void> {
  const transfer = XCMTransfer.create({
    id: `${event.block.block.header.number.toNumber()}-${event.idx}`,
    warnings: "",
    assetId: [],
    amount: [],
    toAddress: "",
    toParachainId: "",
  });
  transfer.blockNumber = event.block.block.header.number.toBigInt();
  transfer.timestamp = event.block.timestamp.toISOString();

  const signedBlock = event.block;
  const allBlockEvents = event.extrinsic.events;
  const allBlockExtrinsics = signedBlock.block.extrinsics;
  // Map all xcmp related events to their extrinsics
  const xcmpExtrinsicsWithEvents = mapXcmpEventsToExtrinsics(
    allBlockExtrinsics,
    allBlockEvents
  );
  if (xcmpExtrinsicsWithEvents.length < 1) {
    transfer.warnings += " - xcmpQueue.<events> are not found";
  } else {
    for (const xcmpExtrinsicWithEvents of xcmpExtrinsicsWithEvents) {
      transfer.xcmpMessageStatus = xcmpExtrinsicWithEvents.status;
      transfer.xcmpMessageHash = xcmpExtrinsicWithEvents.hash;

      switch (xcmpExtrinsicWithEvents.status) {
        case "received":
          await decodeInboundXcmp(xcmpExtrinsicWithEvents, api, transfer);
          break;
        case "sent":
          await decodeOutboundXcmp(
            xcmpExtrinsicWithEvents,
            api,
            chainIDs,
            transfer
          );
          break;
      }
    }
    await transfer.save();
  }
}

async function decodeOutboundXcmp(
  xcmpExtrinsicWithEvents,
  apiAt,
  chainIDs,
  transfer
) {
  transfer.fromParachainId = (
    await apiAt.query.parachainInfo.parachainId()
  ).toString();
  switch (transfer.fromParachainId) {
    case chainIDs.Karura:
      xcmpExtrinsicWithEvents.events.forEach(({ event }) => {
        if (
          event.section == "xTokens" &&
          event.method == "TransferredMultiAssets"
        ) {
          const [account, otherReserve, amount, extra] =
            event.data.toJSON() as any; //ts as any
          // console.log(extra.interior.x2[1].accountKey20.key);
          transfer.amount = amount.fun.fungible.toString();
          transfer.toAddress = extra.interior.x2[1].accountKey20.key;
          transfer.fromAddress = account;
          transfer.toParachainId = extra.interior.x2[0].parachain.toString();
          transfer.assetParachainId =
            amount.id.concrete.interior.x2[0].parachain.toString();
          transfer.assetId = amount.id.concrete.interior.x2[1].generalKey;
        }
      });
      break;
    case chainIDs.Moonriver:
      xcmpExtrinsicWithEvents.events.forEach(({ event }) => {
        if (event.section == "xTokens" && event.method == "Transferred") {
          const [account, otherReserve, amount, extra] =
            event.data.toJSON() as any;
          console.log(otherReserve.otherReserve);

          transfer.amount = amount.toString();
          transfer.toAddress = extra.interior.x2[1].accountId32.id;
          transfer.fromAddress = account;
          transfer.toParachainId = extra.interior.x2[0].parachain;
          transfer.assetParachainId = "NA";
          if (otherReserve.otherReserve) {
            transfer.assetId = otherReserve.otherReserve.toString();
          } else {
            transfer.assetId = "null";
          }
        }
      });
      break;
    default:
      transfer.warnings +=
        " - decodeOutboundXcmp format is not known for parachain: " +
        transfer.fromParachainId;
  }
}

async function decodeInboundXcmp(xcmpExtrinsicWithEvents, apiAt, transfer) {
  transfer.toParachainId = (
    await apiAt.query.parachainInfo.parachainId()
  ).toString();
  xcmpExtrinsicWithEvents.extrinsic.method.args[0].horizontalMessages.forEach(
    (paraMessage, paraId) => {
      if (paraMessage.length >= 1) {
        paraMessage.forEach((message) => {
          const messageHash = blake2AsHex(
            Uint8Array.from(message.data).slice(1)
          );
          if (messageHash == transfer.xcmpMessageHash) {
            // Get readable instructions from byte-array xcmp message
            const instructions = intructionsFromXcmU8Array(
              message.data.slice(1),
              api
            );
            if (typeof instructions == "string") {
              transfer.warnings += instructions;
            } else {
              // Parce instructions and safe relevant info
              parceXcmpInstrustions(instructions, transfer);
              // Calculate SS58 version of address
              const [ans, address] = getSS58AddressForChain(
                transfer.toAddress,
                transfer.toParachainId
              );
              if (ans) {
                transfer.toAddressSS58 = address;
              } else {
                transfer.warnings += address;
              }

              // Save all instructions as an array of JSON,
              // in case detailed information is needed (or parces failed)
              transfer.xcmpInstructions = instructions.map((instruction) =>
                JSON.stringify(instruction, undefined)
              );
            }
          }
        });
      }
    }
  );
}

function mapXcmpEventsToExtrinsics(allBlockExtrinsics, allBlockEvents) {
  // Function takes all extrinsics and events in a block
  // searches for events with "xcmpQueue" section (seems to be the most universal way to filter for xcmp events),
  // puts corresponding extrinsic and all its events in an object,
  // together with xcmp message hash and status (received, sent and unknown).
  // This object is pushed in an array.This array is returned by the function, array contains
  // as many elements as many xcmpQueue.events are found in a block

  const xcmpExtrinsicsWithEvents = [];
  let xcmpStatus = "unknown";
  let xcmpHash = "unknown";
  allBlockExtrinsics.forEach((extrinsic, index) => {
    // filter the specific events based on the phase and then the
    // index of our extrinsic in the block
    const events = allBlockEvents.filter(
      ({ phase }) => phase.isApplyExtrinsic && phase.asApplyExtrinsic.eq(index)
    );
    events.forEach(({ event }) => {
      if (event.section == "xcmpQueue") {
        if (event.method == "XcmpMessageSent") {
          xcmpStatus = "HRMP sent";
          xcmpHash = event.data[0].toString();
        } else if (event.method == "Success") {
          xcmpStatus = "HRMP received";
          xcmpHash = event.data[0].toString();
        }
        xcmpExtrinsicsWithEvents.push({
          extrinsic: extrinsic,
          events: events,
          status: xcmpStatus,
          hash: xcmpHash,
        });
      }
    });
  });
  return xcmpExtrinsicsWithEvents;
}
