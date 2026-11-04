import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { CustomerPrincipal } from '../auth/auth.types';
import { CurrentUser, CustomerAuthGuard } from '../auth/guards';
import { RepayDto } from '../instant-loan/dto';
import { RepaymentService } from './repayment.service';

/** Borrower's loans and self-service repayment (UPI / net banking / debit card). */
@Controller('loans')
@UseGuards(CustomerAuthGuard)
export class LoansController {
  constructor(private readonly svc: RepaymentService) {}

  @Get()
  list(@CurrentUser() u: CustomerPrincipal) {
    return this.svc.myLoans(u);
  }

  @Get(':id')
  detail(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.loanDetail(id, u);
  }

  @Post(':id/payments')
  pay(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RepayDto) {
    return this.svc.createPayment(id, u, dto.amount);
  }

  @Post(':id/payments/:paymentId/refresh') @HttpCode(200)
  refresh(@CurrentUser() u: CustomerPrincipal, @Param('id', ParseUUIDPipe) id: string, @Param('paymentId', ParseUUIDPipe) pid: string) {
    return this.svc.refreshPayment(id, pid, u);
  }
}
