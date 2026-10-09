import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:razorpay_flutter/razorpay_flutter.dart';

class PaymentResult {
  final String orderId, paymentId, signature;
  const PaymentResult(this.orderId, this.paymentId, this.signature);
}

class PaymentFailed implements Exception {
  final String message;
  const PaymentFailed(this.message);
  @override
  String toString() => message;
}

/// Opens Razorpay Checkout (cards, UPI apps, net banking). Resolves with the
/// payment details, null if the member closed it, or throws [PaymentFailed].
Future<PaymentResult?> payWithRazorpay(Map<String, dynamic> options) {
  if (kIsWeb) return Future.error(const PaymentFailed('Payments open in the Android app.'));
  final done = Completer<PaymentResult?>();
  final rzp = Razorpay();
  void finish(void Function() f) {
    if (done.isCompleted) return;
    f();
    // Let the plugin finish its own callback before releasing it.
    Future<void>.delayed(const Duration(milliseconds: 300), rzp.clear);
  }

  rzp.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) {
    finish(() => done.complete(PaymentResult(r.orderId ?? '', r.paymentId ?? '', r.signature ?? '')));
  });
  rzp.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) {
    finish(() {
      if (r.code == Razorpay.PAYMENT_CANCELLED) {
        done.complete(null);
      } else {
        final msg = (r.message ?? '').trim();
        done.completeError(PaymentFailed(
          msg.isEmpty || msg.startsWith('{') ? 'Payment failed. No money was taken. Please try again.' : msg,
        ));
      }
    });
  });
  rzp.on(Razorpay.EVENT_EXTERNAL_WALLET, (ExternalWalletResponse r) {
    // The wallet app completes the payment; the server confirms it by webhook.
    finish(() => done.complete(null));
  });
  try {
    rzp.open(options);
  } catch (e) {
    finish(() => done.completeError(const PaymentFailed('Could not open the payment window. Please try again.')));
  }
  return done.future;
}
