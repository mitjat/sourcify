import { Response, Request } from "express";
import { services } from "../../../../services/services";
import {
  ContractWrapperMap,
  checkContractsInSession,
  getSessionJSON,
  isVerifiable,
  saveFiles,
  verifyContractsInSession,
} from "../../verification.common";
import { PathContent } from "@ethereum-sourcify/lib-sourcify";
import { BadRequestError } from "../../../../../common/errors";
import {
  getMetadataFromCompiler,
  processRequestFromEtherscan,
  stringToBase64,
} from "../etherscan.common";
import {
  checkSupportedChainId,
  sourcifyChainsMap,
} from "../../../../../sourcify-chains";
import { logger } from "../../../../../common/logger";

export async function sessionVerifyFromEtherscan(req: Request, res: Response) {
  const requestId = req.headers["X-Request-ID"] || "";
  const requestIdMsg = requestId ? `requestId=${requestId} ` : "";

  logger.info(`${requestIdMsg} /session/verify - \
    address=${req.body.address} chainId=${req.body.chain}`);

  checkSupportedChainId(req.body.chain);

  const chain = req.body.chain;
  const address = req.body.address;
  const apiKey = req.body.apiKey;
  const sourcifyChain = sourcifyChainsMap[chain];

  const { compilerVersion, solcJsonInput, contractName } =
    await processRequestFromEtherscan(sourcifyChain, address, apiKey);

  const metadata = await getMetadataFromCompiler(
    compilerVersion,
    solcJsonInput,
    contractName
  );

  const pathContents: PathContent[] = Object.keys(solcJsonInput.sources).map(
    (path) => {
      return {
        path: path,
        content: stringToBase64(solcJsonInput.sources[path].content),
      };
    }
  );
  pathContents.push({
    path: "metadata.json",
    content: stringToBase64(JSON.stringify(metadata)),
  });
  const session = req.session;
  const newFilesCount = saveFiles(pathContents, session);
  if (newFilesCount === 0) {
    throw new BadRequestError("The contract didn't add any new file");
  }

  await checkContractsInSession(session);
  if (!session.contractWrappers) {
    throw new BadRequestError(
      "Unknown error during the Etherscan verification process"
    );
    return;
  }

  const verifiable: ContractWrapperMap = {};
  for (const id of Object.keys(session.contractWrappers)) {
    const contractWrapper = session.contractWrappers[id];
    if (contractWrapper) {
      if (!contractWrapper.address) {
        contractWrapper.address = address;
        contractWrapper.chainId = chain;
      }
      if (isVerifiable(contractWrapper)) {
        verifiable[id] = contractWrapper;
      }
    }
  }

  await verifyContractsInSession(
    verifiable,
    session,
    services.verification,
    services.storage
  );
  res.send(getSessionJSON(session));
}
