import { decodeAddress, encodeAddress } from '@polkadot/util-crypto';
import { u8aToHex, hexToU8a, isHex } from '@polkadot/util';

export interface AddressConversion {
  input: string;
  inputFormat: 'ss58' | 'h160';
  ss58: string;
  h160: string;
}

export class AddressConverter {
  // Bittensor SS58 prefix
  private readonly SS58_PREFIX = 42;

  /**
   * Convert between SS58 and H160 address formats
   * Auto-detects the input format and returns both representations
   */
  convert(address: string): AddressConversion {
    const cleanAddress = address.trim();

    // Detect format
    const isH160Format = cleanAddress.startsWith('0x') && isHex(cleanAddress);

    if (isH160Format) {
      // Input is H160, convert to SS58
      const ss58Address = this.h160ToSS58(cleanAddress);
      return {
        input: cleanAddress,
        inputFormat: 'h160',
        ss58: ss58Address,
        h160: cleanAddress.toLowerCase()
      };
    } else {
      // Input is SS58, convert to H160
      const h160Address = this.ss58ToH160(cleanAddress);
      return {
        input: cleanAddress,
        inputFormat: 'ss58',
        ss58: cleanAddress,
        h160: h160Address.toLowerCase()
      };
    }
  }

  /**
   * Convert SS58 address to H160 format
   */
  private ss58ToH160(ss58Address: string): string {
    try {
      const publicKey = decodeAddress(ss58Address);
      return u8aToHex(publicKey);
    } catch (error) {
      throw new Error(`Invalid SS58 address: ${ss58Address}`);
    }
  }

  /**
   * Convert H160 address to SS58 format
   */
  private h160ToSS58(h160Address: string): string {
    try {
      const publicKey = hexToU8a(h160Address);
      return encodeAddress(publicKey, this.SS58_PREFIX);
    } catch (error) {
      throw new Error(`Invalid H160 address: ${h160Address}`);
    }
  }
}
