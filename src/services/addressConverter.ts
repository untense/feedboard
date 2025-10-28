import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { u8aToHex, hexToU8a, isHex } from '@polkadot/util';

export interface AddressConversion {
  input: string;
  inputFormat: 'ss58' | 'hex';
  ss58: string;
  hex: string;
}

export class AddressConverter {
  // Bittensor SS58 prefix
  private readonly SS58_PREFIX = 42;

  /**
   * Convert between SS58 and hex address formats
   * Auto-detects the input format and returns both representations
   */
  convert(address: string): AddressConversion {
    const cleanAddress = address.trim();

    // Detect format
    const isHexFormat = cleanAddress.startsWith('0x') && isHex(cleanAddress);

    if (isHexFormat) {
      // Input is hex, convert to SS58
      const ss58Address = this.hexToSS58(cleanAddress);
      return {
        input: cleanAddress,
        inputFormat: 'hex',
        ss58: ss58Address,
        hex: cleanAddress.toLowerCase()
      };
    } else {
      // Input is SS58, convert to hex
      const hexAddress = this.ss58ToHex(cleanAddress);
      return {
        input: cleanAddress,
        inputFormat: 'ss58',
        ss58: cleanAddress,
        hex: hexAddress.toLowerCase()
      };
    }
  }

  /**
   * Convert SS58 address to hex format
   */
  private ss58ToHex(ss58Address: string): string {
    try {
      const publicKey = decodeAddress(ss58Address);
      return u8aToHex(publicKey);
    } catch (error) {
      throw new Error(`Invalid SS58 address: ${ss58Address}`);
    }
  }

  /**
   * Convert hex address to SS58 format
   */
  private hexToSS58(hexAddress: string): string {
    try {
      const publicKey = hexToU8a(hexAddress);
      return encodeAddress(publicKey, this.SS58_PREFIX);
    } catch (error) {
      throw new Error(`Invalid hex address: ${hexAddress}`);
    }
  }
}
