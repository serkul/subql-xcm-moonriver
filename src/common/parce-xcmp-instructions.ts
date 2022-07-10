interface Transfer {
  warnings: string;
  assetId: string[];
  amount: string[];
  toAddress: string;
}
export function parceXcmpInstrustions(instructions, transfer: Transfer) {
  // Check if xcmp version is 1, then parce the asset part
  // and extract effects/instructions from the object and use
  // them as V2,V3 instructions for further parcing
  if (instructions[0] == "xcmp_asV1") {
    instructions.slice(1).forEach((instruction) => {
      Object.keys(instruction).forEach((key) => {
        let effects: any[] = [];
        switch (key) {
          case "ReserveAssetDeposited":
            instruction.ReserveAssetDeposited.assets.forEach(({ id, fun }) => {
              transfer.assetId.push(JSON.stringify(id.Concrete));
              transfer.amount.push(fun.Fungible.replace(/,/g, ""));
            });
            effects = [...instruction.ReserveAssetDeposited.effects];
          // fall through is intentional
          default:
            if (effects.length > 0) {
              parceV2V3Instruction(effects, transfer);
            }
        }
      });
    });
  } else {
    parceV2V3Instruction(instructions.slice(1), transfer); //first element is xcmp version
  }
}
function parceV2V3Instruction(instructions, transfer: Transfer) {
  // Remove ClearOrigin, its a string and does't contain
  // any info of interest (still can be seen in the list xcmpInstructions)
  const idxClearOrigin = instructions.indexOf("ClearOrigin");
  if (idxClearOrigin > -1) instructions.splice(idxClearOrigin, 1);
  instructions.forEach((instruction) => {
    Object.keys(instruction).forEach((key) => {
      switch (key) {
        case "WithdrawAsset":
          instruction.WithdrawAsset.forEach(({ id, fun }) => {
            transfer.assetId.push(JSON.stringify(id.Concrete));
            transfer.amount.push(
              fun.Fungible?.replace(/,/g, "") ?? JSON.stringify(fun)
            );
          });
          break;
        case "BuyExecution":
          // can get weight limit and fee asset if needed
          break;
        case "DepositAsset":
          transfer.toAddress =
            instruction.DepositAsset.beneficiary.interior.X1.AccountId32?.id ??
            instruction.DepositAsset.beneficiary.interior.X1.AccountKey20.key;
          break;
        default:
          transfer.warnings += ` - Unknown instruction name ${key}`;
      }
    });
  });
}
// export function parceXcmpInstrustions(instructions, transfer) {
//   instructions.forEach((instruction) => {
//     Object.keys(instruction).forEach((key) => {
//       switch (key) {
//         case "WithdrawAsset":
//           transfer.amount =
//             instruction.WithdrawAsset[0].fun.Fungible.toString();
//           transfer.assetId = JSON.stringify(instruction.WithdrawAsset[0].id);
//           break;
//         // case "BuyExecution":
//         //   transfer.fees = JSON.stringify(instruction.BuyExecution);
//         //   break;
//         case "DepositAsset":
//           transfer.toAddress =
//             instruction.DepositAsset.beneficiary.interior.X1.AccountId32.id;
//           break;
//       }
//     });
//   });
// }
