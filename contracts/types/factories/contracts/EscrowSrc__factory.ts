/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */
import {
  Contract,
  ContractFactory,
  ContractTransactionResponse,
  Interface,
} from "ethers";
import type { Signer, ContractDeployTransaction, ContractRunner } from "ethers";
import type { NonPayableOverrides } from "../../common";
import type { EscrowSrc, EscrowSrcInterface } from "../../contracts/EscrowSrc";

const _abi = [
  {
    inputs: [],
    name: "ReentrancyGuardReentrantCall",
    type: "error",
  },
  {
    inputs: [
      {
        internalType: "address",
        name: "token",
        type: "address",
      },
    ],
    name: "SafeERC20FailedOperation",
    type: "error",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "orderId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "token",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "secretHash",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "timelock",
        type: "uint256",
      },
    ],
    name: "EscrowCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "orderId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "bytes32",
        name: "secret",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "redeemer",
        type: "address",
      },
    ],
    name: "Redeemed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "bytes32",
        name: "orderId",
        type: "bytes32",
      },
      {
        indexed: true,
        internalType: "address",
        name: "refundee",
        type: "address",
      },
    ],
    name: "Refunded",
    type: "event",
  },
  {
    inputs: [],
    name: "RESOLVER_EXCLUSIVE_PERIOD",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "amount",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "secret",
        type: "bytes32",
      },
    ],
    name: "canRedeem",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "canRefund",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "depositor",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "emergencyRecover",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "getDetails",
    outputs: [
      {
        internalType: "bytes32",
        name: "_orderId",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_depositor",
        type: "address",
      },
      {
        internalType: "address",
        name: "_withdrawer",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_secretHash",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "_timelock",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "_safetyDeposit",
        type: "uint256",
      },
      {
        internalType: "bool",
        name: "_isRedeemed",
        type: "bool",
      },
      {
        internalType: "bool",
        name: "_isRefunded",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "_orderId",
        type: "bytes32",
      },
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_amount",
        type: "uint256",
      },
      {
        internalType: "address",
        name: "_depositor",
        type: "address",
      },
      {
        internalType: "address",
        name: "_withdrawer",
        type: "address",
      },
      {
        internalType: "bytes32",
        name: "_secretHash",
        type: "bytes32",
      },
      {
        internalType: "uint256",
        name: "_timelock",
        type: "uint256",
      },
      {
        internalType: "uint256",
        name: "_safetyDeposit",
        type: "uint256",
      },
    ],
    name: "initialize",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "isRedeemed",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "isRefunded",
    outputs: [
      {
        internalType: "bool",
        name: "",
        type: "bool",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "orderId",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "secret",
        type: "bytes32",
      },
    ],
    name: "publicWithdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes32",
        name: "secret",
        type: "bytes32",
      },
    ],
    name: "redeem",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "refund",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [],
    name: "safetyDeposit",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "secretHash",
    outputs: [
      {
        internalType: "bytes32",
        name: "",
        type: "bytes32",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "timelock",
    outputs: [
      {
        internalType: "uint256",
        name: "",
        type: "uint256",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "token",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "withdrawer",
    outputs: [
      {
        internalType: "address",
        name: "",
        type: "address",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    stateMutability: "payable",
    type: "receive",
  },
] as const;

const _bytecode =
  "0x6080806040523461001b57600160005561129190816100218239f35b600080fdfe6080604090808252600490813610156100a3575b50361561001f57600080fd5b60ff60095460101c16158015610079575b1561003757005b6020606492519162461bcd60e51b8352820152601960248201527f457363726f775372633a20556e657870656374656420455448000000000000006044820152fd5b506002546001600160a01b03908116159081610096575b50610030565b9050815416331438610090565b600090813560e01c908163034f6b2114610f4e57508063163de5e514610f2f5780631732c69f14610f105780631b99221814610de25780633812e09f14610dc55780634d5cef0514610a8757806356ea5f901461090b578063590e1ae3146107f6578063779cd083146107cf5780637f83a4a61461076c578063aa8c217c1461074d578063aeb6217214610694578063c7c4ff461461066b578063cdc1842414610642578063d0e30db01461042e578063d29e68031461040f578063d33219b4146103f0578063eda1122c1461023e578063fbbf93a0146101b45763fc0c546a036100135782346101b057816003193601126101b05760025490516001600160a01b039091168152602090f35b5080fd5b5082903461023b578060031936011261023b575060ff610140926001549260018060a01b03918260025416928060035492541690600554166006549160075493600854956009549781519a8b5260208b01528901526060880152608087015260a086015260c085015260e0840152818116151561010084015260081c161515610120820152f35b80fd5b509190346103ec576020806003193601126103e85781359061028260ff60095461026c828260101c16610f6f565b61027882821615611078565b60081c16156110c4565b61028a611055565b80856102ad865185848201528381526102a281610fbb565b875191828092611110565b039060025afa15610369576102c685516006541461113b565b6102d36007544210611187565b6005546001600160a01b0393908416903382900361037f575061030290600160ff1960095416176009556111d3565b8460085480158015610349575b5050507fb0baf4fee86ba591aeafdbee2bfd201e35b3d709a78df0506919c06ba898d78a9160015493600554169451908152a36001815580f35b82809281928860055416908390610376575bf1156103695784388061030f565b50505051903d90823e3d90fd5b506108fc61035b565b855162461bcd60e51b8152908101839052603960248201527f457363726f775372633a204f6e6c7920776974686472617765722063616e207260448201527f656465656d20696e206578636c757369766520706572696f64000000000000006064820152608490fd5b8380fd5b8280fd5b5082346101b057816003193601126101b0576020906007549051908152f35b5082346101b057816003193601126101b0576020906006549051908152f35b5091826003193601126103ec5760095461044d60ff8260101c16610f6f565b60ff8116159081610633575b50156105f057610467611055565b81546001600160a01b03908116330361059f5760025416806104da575060035434036104975750505b6001815580f35b906020606492519162461bcd60e51b8352820152601f60248201527f457363726f775372633a20496e636f72726563742045544820616d6f756e74006044820152fd5b9291923461054757600354918051926323b872dd60e01b602085015233602485015230604485015260648401526064835260a083019083821067ffffffffffffffff8311176105345761052f94955052610fed565b610490565b634e487b7160e01b855260418652602485fd5b815162461bcd60e51b8152602081860152602c60248201527f457363726f775372633a204e6f2045544820657870656374656420666f72207460448201526b1bdad95b8819195c1bdcda5d60a21b6064820152608490fd5b815162461bcd60e51b8152602081850152602560248201527f457363726f775372633a204f6e6c79206465706f7369746f722063616e2064656044820152641c1bdcda5d60da1b6064820152608490fd5b906020606492519162461bcd60e51b8352820152601c60248201527f457363726f775372633a20457363726f77206e6f7420616374697665000000006044820152fd5b60ff915060081c161538610459565b5082346101b057816003193601126101b05760055490516001600160a01b039091168152602090f35b509190346103ec57826003193601126103ec575490516001600160a01b03909116815260209150f35b5091346103ec5760203660031901126103ec576009549160ff8360101c169283610741575b83610732575b50826106e5575b5060209250816106d9575b519015158152f35b600754421091506106d1565b81925061070e84916020935190358482015283815261070381610fbb565b845191828092611110565b039060025afa1561072857602091516006541490386106c6565b51903d90823e3d90fd5b60081c60ff16159250386106bf565b60ff81161593506106b9565b5082346101b057816003193601126101b0576020906003549051908152f35b5082346101b057816003193601126101b0576020906009549060ff8260101c1691826107c3575b826107b4575b50816107a757519015158152f35b60075442101591506106d1565b60081c60ff1615915083610799565b60ff8116159250610793565b5082346101b057816003193601126101b05760209060ff60095460081c1690519015158152f35b5091346103ec57826003193601126103ec5761081e60ff60095461026c828260101c16610f6f565b610826611055565b60075442106108c8576009805461ff00191661010017905581546001600160a01b0391906108559083166111d3565b836008548015908115610899575b50505050600154915416907f5e9f0820fcfb53b644becb775b651bae68c337106f21433e526551d1e02c1c0e8380a36001815580f35b82809291819282906108bf575b3390f1156108b657838180610863565b513d84823e3d90fd5b506108fc6108a6565b906020606492519162461bcd60e51b8352820152601a60248201527f457363726f775372633a204265666f72652074696d656c6f636b0000000000006044820152fd5b509190346103ec57602090816003193601126103e85780359061093a60ff60095461026c828260101c16610f6f565b610942611055565b828561095a865185848201528381526102a281610fbb565b039060025afa156103695761097385516006541461113b565b600754610981814210611187565b610e0f198101908111610a74574210610a2557506009805460ff191660011790556005546001600160a01b0392906109ba9084166111d3565b8460085480158015610a00575050507fb0baf4fee86ba591aeafdbee2bfd201e35b3d709a78df0506919c06ba898d78a9160015493600554169451908152a36001815580f35b82809281928290610a1c575b3390f1156103695784388061030f565b506108fc610a0c565b835162461bcd60e51b81529081018390526024808201527f457363726f775372633a205374696c6c20696e206578636c75736976652070656044820152631c9a5bd960e21b6064820152608490fd5b634e487b7160e01b865260118252602486fd5b5091906101003660031901126103ec576001600160a01b0360248035828116948435949293929091869003610dc157604493843594606494853593818516809503610dbd57608435918216809203610dbd5760a4359460c4359760e435946009549660ff8860101c16610d7e578c15610d3f578b15610cf4578315610cb5578515610c76578815610c3757428b1115610bf857863403610bac575050509262010000928b7f1dc5681327f936fe0c2a1831dce25e213e716a6d97d65135485fefaf491223479a98969360609a98968d6001556bffffffffffffffffffffffff60a01b928360025416176002558a600355828254161790556005541617600555836006558560075560085562ff000019161760095581519384526020840152820152a380f35b6084927f457363726f775372633a20496e636f727265637420736166657479206465706f86936023621cda5d60ea1b9460208f519762461bcd60e51b8952880152860152840152820152fd5b8491601b7f457363726f775372633a20496e76616c69642074696d656c6f636b00000000009260208d519562461bcd60e51b8752860152840152820152fd5b8491601e7f457363726f775372633a20496e76616c696420736563726574206861736800009260208d519562461bcd60e51b8752860152840152820152fd5b8491601d7f457363726f775372633a20496e76616c696420776974686472617765720000009260208d519562461bcd60e51b8752860152840152820152fd5b8491601c7f457363726f775372633a20496e76616c6964206465706f7369746f72000000009260208d519562461bcd60e51b8752860152840152820152fd5b6084927f457363726f775372633a20416d6f756e74206d75737420626520706f736974698693602261766560f01b9460208f519762461bcd60e51b8952880152860152840152820152fd5b8491601b7f457363726f775372633a20496e76616c6964206f7264657220494400000000009260208d519562461bcd60e51b8752860152840152820152fd5b8491601e7f457363726f775372633a20416c726561647920696e697469616c697a656400009260208d519562461bcd60e51b8752860152840152820152fd5b8a80fd5b8680fd5b5082346101b057816003193601126101b05760209051610e108152f35b5091346103ec57826003193601126103ec57610e0560ff60095460101c16610f6f565b610e0d611055565b60075462093a808101809111610efd574210610eaa5760095460ff81161580610e9c575b15610e595761ff0019166101001760095581546001600160a01b0391906108559083166111d3565b815162461bcd60e51b8152602081850152601b60248201527f457363726f775372633a20416c7265616479207265736f6c76656400000000006044820152606490fd5b5060ff8160081c1615610e31565b906020608492519162461bcd60e51b8352820152602760248201527f457363726f775372633a20456d657267656e637920706572696f64206e6f74206044820152661c995858da195960ca1b6064820152fd5b634e487b7160e01b845260118352602484fd5b5082346101b057816003193601126101b0576020906008549051908152f35b5082346101b057816003193601126101b0576020906001549051908152f35b9050346101b057816003193601126101b05760209060ff6009541615158152f35b15610f7657565b60405162461bcd60e51b815260206004820152601a60248201527f457363726f775372633a204e6f7420696e697469616c697a65640000000000006044820152606490fd5b6040810190811067ffffffffffffffff821117610fd757604052565b634e487b7160e01b600052604160045260246000fd5b906000602091828151910182855af115611049576000513d61104057506001600160a01b0381163b155b61101e5750565b604051635274afe760e01b81526001600160a01b039091166004820152602490fd5b60011415611017565b6040513d6000823e3d90fd5b600260005414611066576002600055565b604051633ee5aeb560e01b8152600490fd5b1561107f57565b60405162461bcd60e51b815260206004820152601b60248201527f457363726f775372633a20416c72656164792072656465656d656400000000006044820152606490fd5b156110cb57565b60405162461bcd60e51b815260206004820152601b60248201527f457363726f775372633a20416c726561647920726566756e64656400000000006044820152606490fd5b9081519160005b838110611128575050016000815290565b8060208092840101518185015201611117565b1561114257565b60405162461bcd60e51b815260206004820152601960248201527f457363726f775372633a20496e76616c696420736563726574000000000000006044820152606490fd5b1561118e57565b60405162461bcd60e51b815260206004820152601860248201527f457363726f775372633a20506173742074696d656c6f636b00000000000000006044820152606490fd5b6002546001600160a01b0391908216806112105750600080809381936003549183918315611206575b1690f11561104957565b6108fc92506111fc565b91600354906040519263a9059cbb60e01b6020850152166024830152604482015260448152608081019181831067ffffffffffffffff841117610fd75761125992604052610fed565b56fea26469706673582212200dc4915280313c19db1a530f70f16ca7486aa327d5bd7e575270c8675a0e90ba64736f6c63430008140033";

type EscrowSrcConstructorParams =
  | [signer?: Signer]
  | ConstructorParameters<typeof ContractFactory>;

const isSuperArgs = (
  xs: EscrowSrcConstructorParams
): xs is ConstructorParameters<typeof ContractFactory> => xs.length > 1;

export class EscrowSrc__factory extends ContractFactory {
  constructor(...args: EscrowSrcConstructorParams) {
    if (isSuperArgs(args)) {
      super(...args);
    } else {
      super(_abi, _bytecode, args[0]);
    }
    this.contractName = "EscrowSrc";
  }

  override getDeployTransaction(
    overrides?: NonPayableOverrides & { from?: string }
  ): Promise<ContractDeployTransaction> {
    return super.getDeployTransaction(overrides || {});
  }
  override deploy(overrides?: NonPayableOverrides & { from?: string }) {
    return super.deploy(overrides || {}) as Promise<
      EscrowSrc & {
        deploymentTransaction(): ContractTransactionResponse;
      }
    >;
  }
  override connect(runner: ContractRunner | null): EscrowSrc__factory {
    return super.connect(runner) as EscrowSrc__factory;
  }
  static readonly contractName: "EscrowSrc";

  public readonly contractName: "EscrowSrc";

  static readonly bytecode = _bytecode;
  static readonly abi = _abi;
  static createInterface(): EscrowSrcInterface {
    return new Interface(_abi) as EscrowSrcInterface;
  }
  static connect(address: string, runner?: ContractRunner | null): EscrowSrc {
    return new Contract(address, _abi, runner) as unknown as EscrowSrc;
  }
}
