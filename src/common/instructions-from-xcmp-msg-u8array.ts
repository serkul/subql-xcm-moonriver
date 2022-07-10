export function intructionsFromXcmU8Array(messageData, apiAt) {
  // Create type for instructions
  let instructions = apiAt.registry.createType("XcmVersionedXcm", messageData); //ts as any

  // choose appropriate xcmp version
  let asVersion = "not found";
  for (const versionNum of ["0", "1", "2"]) {
    if (instructions["isV" + versionNum]) {
      asVersion = "asV" + versionNum;
    }
  }
  // Return string message if the version is not found
  if (asVersion === "not found") {
    return " - xcmp version not found";
  } else {
    // Push readable instruction in an array
    let instructionsHuman: any[] = [];
    // Store as which version message is decoded as first ellement
    instructionsHuman.push("xcmp_" + asVersion);
    // V1 sends all instructions in one object, needed for parceXcmpInstructions function
    if (asVersion == "asV1") {
      // xcmpVersion1 has all instructions in one object
      instructionsHuman.push(instructions.asV1.toHuman());
    } else {
      instructions[asVersion].forEach((instruction) => {
        instructionsHuman.push(instruction.toHuman());
      });
    }
    // Return the array containing instructions
    return instructionsHuman;
  }
}
// export function intrustionsFromBytesXCMP(messageData, apiAt) {
//   // // We recover all instructions
//   let instructions = apiAt.registry.createType(
//     "XcmVersionedXcm",
//     messageData
//   ) as any;

//   // choose appropriate xcm version
//   let asVersion = "not found";
//   for (const versionNum of ["0", "1", "2"]) {
//     if (instructions["isV" + versionNum]) {
//       asVersion = "asV" + versionNum;
//     }
//   }
//   if (asVersion === "not found") {
//     return " - xcmp version not found";
//   } else {
//     let instructionsHuman: any[] = [];
//     instructions[asVersion].forEach((instruction) => {
//       instructionsHuman.push(instruction.toHuman());
//     });
//     return instructionsHuman;
//   }
// }
