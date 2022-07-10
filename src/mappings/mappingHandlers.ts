import { SubstrateExtrinsic, SubstrateEvent } from "@subql/types";
import { XCMTransfer } from "../types";
import { blake2AsU8a, blake2AsHex } from "@polkadot/util-crypto";
import { u8aToHex } from "@polkadot/util";
import { intructionsFromXcmU8Array } from "../common/instructions-from-xcmp-msg-u8array";
import { parceXcmpInstrustions } from "../common/parce-xcmp-instructions";

// Fill with all ids and move to separate file
const chainIDs = {
  Karura: "2000",
  Moonriver: "2023",
};

export async function handleDmpParaEvent(event: SubstrateEvent): Promise<void> {
  const transfer = XCMTransfer.create({
    id: `${event.block.block.header.number.toNumber()}-${event.idx}`,
    warnings: "",
    assetId: [],
    amount: [],
    toAddress: "",
    amountIssued: [],
    assetIdIssued: [],
    xcmpTransferStatus: [],
  });
  transfer.blockNumber = event.block.block.header.number.toBigInt();
  transfer.timestamp = event.block.timestamp.toISOString();

  transfer.xcmpMessageHash =
    event.block.events[event.idx].event.data[0].toString();
  transfer.xcmpMessageStatus = "DMP received";
  const dmpParaExtrinsic: any = event.extrinsic.extrinsic; // parachainSystem.setValidationData
  dmpParaExtrinsic.method.args[0].downwardMessages.forEach(
    ({ sentAt, msg }) => {
      const messageHash = blake2AsHex(Uint8Array.from(msg));
      if (messageHash == transfer.xcmpMessageHash) {
        const instructions = intructionsFromXcmU8Array(msg, api);
        if (typeof instructions == "string") {
          transfer.warnings += instructions;
        } else {
          parceXcmpInstrustions(instructions, transfer);
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
      transfer.amountIssued.push(event.toHuman().data.totalSupply);
      transfer.assetIdIssued.push(event.toHuman().data.assetId);
    }
  });

  await transfer.save();
}
export async function handleEvent(event: SubstrateEvent): Promise<void> {
  const transfer = new XCMTransfer(
    `${event.block.block.header.number.toNumber()}-${event.idx}`
  );
  transfer.warnings = "";
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
    transfer.warnings += " - no xcmpQueue.<events> are found";
  } else if (xcmpExtrinsicsWithEvents.length > 2) {
    transfer.warnings += " - more than one xcmpQueue.<events> are found";
  } else {
    transfer.xcmpMessageStatus = xcmpExtrinsicsWithEvents[0].status;
    transfer.xcmpMessageHash = xcmpExtrinsicsWithEvents[0].hash;

    switch (xcmpExtrinsicsWithEvents[0].status) {
      case "received":
        await decodeInboundXcmp(xcmpExtrinsicsWithEvents[0], api, transfer);
        break;
      case "sent":
        await decodeOutboundXcmp(
          xcmpExtrinsicsWithEvents[0],
          api,
          chainIDs,
          transfer
        );
        break;
    }

    await transfer.save();
  }
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
          xcmpStatus = "sent";
          xcmpHash = event.data[0].toString();
        } else if (event.method == "Success") {
          xcmpStatus = "received";
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
          // const messageHash = u8aToHex(
          //   blake2AsU8a(message.data.slice(1))
          // ); //this way of computing hash, casts into String before feeding it to blake2AsU8a(); why?, hz
          const messageHash = blake2AsHex(
            Uint8Array.from(message.data).slice(1)
          );

          // logger.info(`${message.data.slice(1)}`);
          // logger.info(`${blake2AsHex(message.data.slice(1))}`);
          // logger.info(`${Uint8Array.from(message.data).slice(1)}`);
          // logger.info(`${blake2AsHex(Uint8Array.from(message.data).slice(1))}`);

          if (messageHash == transfer.xcmpMessageHash) {
            transfer.fromParachainId = paraId.toString();
            // let instructions = api.createType(
            let instructions = apiAt.registry.createType(
              "XcmVersionedXcm",
              message.data.slice(1)
            ) as any; //ts as any
            // choose appropriate xcm version
            let asVersion = "not found";
            for (const versionNum of ["0", "1", "2"]) {
              if (instructions["isV" + versionNum]) {
                asVersion = "asV" + versionNum;
              }
            }
            if (asVersion === "not found") {
              transfer.warnings += " - xcmp version not found";
            }
            instructions[asVersion].forEach((instruction) => {
              switch (transfer.toParachainId) {
                case chainIDs.Moonriver:
                  if (instruction.isReserveAssetDeposited) {
                    transfer.amount = instruction
                      .toHuman()
                      .ReserveAssetDeposited[0].fun.Fungible.toString();
                    transfer.assetParachainId = instruction
                      .toHuman()
                      .ReserveAssetDeposited[0].id.Concrete.interior.X2[0].Parachain.toString();
                    transfer.assetId =
                      instruction.toHuman().ReserveAssetDeposited[0].id.Concrete.interior.X2[1].GeneralKey;
                  }
                  // if (instruction.isBuyExecution) { //contains weight limit and asset ID
                  //   console.log(
                  //     instruction.toHuman().BuyExecution.fees.id.Concrete.interior.X2
                  //   );
                  // }
                  if (instruction.isDepositAsset) {
                    transfer.toAddress =
                      instruction.toHuman().DepositAsset.beneficiary.interior.X1.AccountKey20.key;
                  }
                  break;
                case chainIDs.Karura:
                  // console.log(instruction.toHuman());
                  if (instruction.isWithdrawAsset) {
                    transfer.amount = instruction
                      .toHuman()
                      .WithdrawAsset[0].fun.Fungible.toString();
                    transfer.assetParachainId = "NA";
                    transfer.assetId =
                      instruction.toHuman().WithdrawAsset[0].id.Concrete.interior.X1.GeneralKey;
                  }
                  // // if (instruction.isBuyExecution) { //contains weight limit and asset ID
                  // // }
                  if (instruction.isDepositAsset) {
                    transfer.toAddress =
                      instruction.toHuman().DepositAsset.beneficiary.interior.X1.AccountId32.id;
                  }

                  break;
                default:
                  transfer.warnings +=
                    " - decodeInboundXcmp format is not known for parachain: " +
                    transfer.fromParachainId;
              }
            });
          }
        });
      }
    }
  );
}
