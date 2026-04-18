import hre from 'hardhat';
import { ethers } from 'hardhat';
import { privateKeyToAccount } from 'viem/accounts';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log('Deploying FhenixPoll from:', deployer.address);

  // Derive verifier address from VERIFIER_PRIVATE_KEY env var
  const rawVerifierKey = process.env.VERIFIER_PRIVATE_KEY;
  if (!rawVerifierKey) throw new Error('VERIFIER_PRIVATE_KEY not set in environment');
  const verifierKey = rawVerifierKey.startsWith('0x') ? rawVerifierKey : `0x${rawVerifierKey}`;
  const verifierAccount = privateKeyToAccount(verifierKey as `0x${string}`);
  const verifierAddress = verifierAccount.address;
  console.log('Verifier address:', verifierAddress);

  const Factory = await ethers.getContractFactory('FhenixPoll');
  const contract = await Factory.deploy(verifierAddress);
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log('FhenixPoll deployed to:', contractAddress);

  // Export ABI + address to frontend
  const artifact = await hre.artifacts.readArtifact('FhenixPoll');
  const output = {
    address: contractAddress,
    abi: artifact.abi,
    network: hre.network.name,
    deployedAt: new Date().toISOString(),
  };

  const outPath = path.resolve(__dirname, '../../frontend/src/lib/abi.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('ABI + address written to:', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
