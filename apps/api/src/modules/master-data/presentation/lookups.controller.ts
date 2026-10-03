import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiStandardErrors, ifscBranchDetails, lookupPincode, Public, RateLimit } from '@http';
import { NotFoundError, ValidationError } from '@kernel';

import { GeographyRepository } from '../infrastructure/persistence/geography.repository';

/**
 * Fill-in helpers for address and bank forms: a PIN code gives the city, state
 * and localities; an IFSC gives the bank and branch. Public, because the
 * operator sign-up form needs them before anyone has an account.
 */
@ApiTags('master-data')
@Controller({ path: 'master-data/lookups', version: '1' })
@ApiStandardErrors()
export class LookupsController {
  constructor(private readonly geography: GeographyRepository) {}

  @Public()
  @Get('pincode/:pincode')
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({
    summary:
      'City, state and localities of an Indian PIN code (and the matching city here, if any)',
  })
  async pincode(@Param('pincode') pincode: string) {
    const pin = pincode.trim();
    if (!/^[1-9]\d{5}$/.test(pin))
      throw new ValidationError([
        {
          path: 'pincode',
          rule: 'pattern',
          message: 'A PIN code is 6 digits and does not start with 0',
        },
      ]);
    const info = lookupPincode(pin);
    if (!info) throw new NotFoundError('PIN code', pin);
    // The platform's own city of that name, when it has one (routes and stops use it).
    const slug = info.city
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase();
    const city = await this.geography.findBySlug(slug);
    return { ...info, cityId: city?.id ?? null };
  }

  @Public()
  @Get('ifsc/:ifsc')
  @RateLimit(60, 60_000, 'ip')
  @ApiOperation({
    summary: 'Bank (and, when the directory answers, branch, address, city) of an IFSC',
  })
  async ifsc(@Param('ifsc') ifsc: string) {
    const code = ifsc.trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code))
      throw new ValidationError([
        { path: 'ifsc', rule: 'pattern', message: 'An IFSC is 11 characters, like HDFC0001234' },
      ]);
    const details = await ifscBranchDetails(code);
    if (!details) throw new NotFoundError('IFSC', code);
    return details;
  }
}
