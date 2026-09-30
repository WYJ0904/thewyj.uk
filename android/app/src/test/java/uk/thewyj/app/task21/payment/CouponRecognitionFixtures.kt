package uk.thewyj.app.task21.payment

internal object CouponRecognitionFixtures {
    // Exact user-reported false positive. The 50 yuan is a voucher face value;
    // 5,000–30,000 yuan are future spend thresholds, not completed transactions.
    const val sms = "【湖北恒隆】尊敬的会员，您好！专属50元餐券已发放至您的券包，10/1‑10/4 “落日酒场”亚太8家酒吧齐聚解锁微醺夜晚，10/1-10/3&10/7消费满5,000-30,000元可赠100-600元Ole超市券，更多详情请关注武汉恒隆广场公众号，祝您节日快乐。拒收请回复R"

    val nonCashMessages = listOf(
        sms,
        "您获得6元优惠券，已到账",
        "优惠券已入账 ¥6.00",
        "获得6元立减券，领取成功",
        "支付可享6元立减券",
        "支付成功后可获得50元餐券",
        "优惠券退款成功50元",
        "优惠券退回成功，6元已返还至券包",
    )
}
