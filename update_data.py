#!/usr/bin/env python
"""Generate 2025 dashboard data with promotional analytics."""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

data = {
    "meta": {
        "engine": "sample",
        "sources": ["sample://dashboard_data.example.json"],
        "generated_at": "2025-12-31T23:59:59Z",
        "total_events": 2156000,
        "total_sessions": 512450,
        "engine_requested": "sample",
        "engine_used": "sample",
        "cleaning_policy": "2025 Data with Promotional Analytics",
        "data_year": 2025,
        "capabilities": {
            "funnel_available": False,
            "traffic_events_available": False,
            "orders_available": True,
            "promotions_available": True
        }
    },
    "filters": {
        "date_range": {
            "start": "2025-01-01",
            "end": "2025-12-31"
        },
        "categories": ["electronics", "appliances", "beauty", "fashion", "home_living", "sports"],
        "products": [
            {"product_id": 1003461, "product_name": "iPhone 15 Pro Max 256GB", "category": "electronics"},
            {"product_id": 1003478, "product_name": "Samsung Galaxy S24 Ultra", "category": "electronics"},
            {"product_id": 2001120, "product_name": "Dyson V15 Detect", "category": "home_living"},
            {"product_id": 3004511, "product_name": "Nike Air Zoom Pegasus 41", "category": "fashion"},
            {"product_id": 4008820, "product_name": "Estee Lauder Advanced Night Repair", "category": "beauty"}
        ]
    },
    "dashboard": {
        "kpis": {
            "total_revenue": 12485320.85,
            "revenue_growth_pct": 28.4,
            "average_order_value": 145.82,
            "total_orders": 85620,
            "conversion_rate_pct": 3.24,
            "daily_active_users_avg": 142580.3,
            "returning_customers_pct": 72.45,
            "new_customers_pct": 27.55,
            "estimated_clv": 285.34,
            "avg_promotion_discount_pct": 18.5
        }
    },
    "revenue": {
        "monthly": [
            {"month": "2025-01", "revenue": 892450.50, "orders": 6125, "buyers": 5823, "promotion_contribution_pct": 22.3},
            {"month": "2025-02", "revenue": 945320.75, "orders": 6489, "buyers": 6124, "promotion_contribution_pct": 25.1},
            {"month": "2025-03", "revenue": 1025840.20, "orders": 7032, "buyers": 6687, "promotion_contribution_pct": 28.5},
            {"month": "2025-04", "revenue": 1105320.40, "orders": 7582, "buyers": 7192, "promotion_contribution_pct": 31.2},
            {"month": "2025-05", "revenue": 1245680.30, "orders": 8541, "buyers": 8124, "promotion_contribution_pct": 35.8},
            {"month": "2025-06", "revenue": 1385920.60, "orders": 9512, "buyers": 9048, "promotion_contribution_pct": 38.5},
            {"month": "2025-07", "revenue": 1425340.80, "orders": 9785, "buyers": 9341, "promotion_contribution_pct": 40.2},
            {"month": "2025-08", "revenue": 1385120.50, "orders": 9521, "buyers": 9087, "promotion_contribution_pct": 39.1},
            {"month": "2025-09", "revenue": 1245630.70, "orders": 8543, "buyers": 8126, "promotion_contribution_pct": 36.7},
            {"month": "2025-10", "revenue": 1185420.30, "orders": 8125, "buyers": 7745, "promotion_contribution_pct": 33.4},
            {"month": "2025-11", "revenue": 1425680.40, "orders": 9784, "buyers": 9341, "promotion_contribution_pct": 45.8},
            {"month": "2025-12", "revenue": 1625340.70, "orders": 10685, "buyers": 10182, "promotion_contribution_pct": 48.2}
        ],
        "seasonality": [
            {"day_of_week": "Monday", "avg_revenue": 165450.20, "avg_orders": 1135, "promotion_orders_pct": 32.5},
            {"day_of_week": "Tuesday", "avg_revenue": 168920.50, "avg_orders": 1158, "promotion_orders_pct": 31.2},
            {"day_of_week": "Wednesday", "avg_revenue": 172580.40, "avg_orders": 1185, "promotion_orders_pct": 30.8},
            {"day_of_week": "Thursday", "avg_revenue": 185320.60, "avg_orders": 1271, "promotion_orders_pct": 34.2},
            {"day_of_week": "Friday", "avg_revenue": 198560.80, "avg_orders": 1362, "promotion_orders_pct": 38.5},
            {"day_of_week": "Saturday", "avg_revenue": 225640.50, "avg_orders": 1547, "promotion_orders_pct": 42.1},
            {"day_of_week": "Sunday", "avg_revenue": 212850.30, "avg_orders": 1459, "promotion_orders_pct": 40.3}
        ]
    },
    "categories": {
        "categories": [
            {
                "category": "electronics",
                "revenue": 5245680.50,
                "orders": 28540,
                "buyers": 27125,
                "revenue_share_pct": 42.0,
                "growth_pct": 35.2,
                "avg_order_value": 183.65,
                "promotion_impact_pct": 32.5
            },
            {
                "category": "appliances",
                "revenue": 3185420.70,
                "orders": 18245,
                "buyers": 17341,
                "revenue_share_pct": 25.5,
                "growth_pct": 28.1,
                "avg_order_value": 174.82,
                "promotion_impact_pct": 28.3
            },
            {
                "category": "fashion",
                "revenue": 1850450.30,
                "orders": 15678,
                "buyers": 14925,
                "revenue_share_pct": 14.8,
                "growth_pct": 42.5,
                "avg_order_value": 118.05,
                "promotion_impact_pct": 35.8
            },
            {
                "category": "beauty",
                "revenue": 1245680.20,
                "orders": 12541,
                "buyers": 11842,
                "revenue_share_pct": 10.0,
                "growth_pct": 31.2,
                "avg_order_value": 99.28,
                "promotion_impact_pct": 22.1
            },
            {
                "category": "home_living",
                "revenue": 685420.15,
                "orders": 7254,
                "buyers": 6891,
                "revenue_share_pct": 5.5,
                "growth_pct": 38.7,
                "avg_order_value": 94.47,
                "promotion_impact_pct": 19.5
            },
            {
                "category": "sports",
                "revenue": 272670.00,
                "orders": 3362,
                "buyers": 3206,
                "revenue_share_pct": 2.2,
                "growth_pct": 15.3,
                "avg_order_value": 81.15,
                "promotion_impact_pct": 12.8
            }
        ]
    },
    "promotions": {
        "top_promotions": [
            {
                "promotion_id": "FLASH2025",
                "name": "Flash Sale 50% Off Electronics",
                "type": "percentage_discount",
                "discount_pct": 50,
                "start_date": "2025-06-15",
                "end_date": "2025-06-20",
                "categories": ["electronics"],
                "total_participants": 45280,
                "orders_generated": 12540,
                "revenue_generated": 1850320.50,
                "avg_conversion_lift_pct": 125.3,
                "customer_acquisition_cost": 4.80,
                "repeat_purchase_rate_pct": 32.5
            },
            {
                "promotion_id": "SUMMER2025",
                "name": "Summer Sale - Multiple Categories",
                "type": "tiered_discount",
                "discount_pct": 35,
                "start_date": "2025-07-01",
                "end_date": "2025-07-31",
                "categories": ["appliances", "fashion", "home_living"],
                "total_participants": 82150,
                "orders_generated": 18245,
                "revenue_generated": 2245680.30,
                "avg_conversion_lift_pct": 98.5,
                "customer_acquisition_cost": 5.20,
                "repeat_purchase_rate_pct": 28.3
            },
            {
                "promotion_id": "BDAY2025",
                "name": "Birthday Month Exclusive - 25% Off",
                "type": "percentage_discount",
                "discount_pct": 25,
                "start_date": "2025-08-01",
                "end_date": "2025-08-31",
                "categories": ["beauty", "fashion"],
                "total_participants": 38640,
                "orders_generated": 9785,
                "revenue_generated": 1125430.80,
                "avg_conversion_lift_pct": 85.2,
                "customer_acquisition_cost": 3.50,
                "repeat_purchase_rate_pct": 35.8
            },
            {
                "promotion_id": "BLACK2025",
                "name": "Black Friday Mega Sale - 60% Off",
                "type": "percentage_discount",
                "discount_pct": 60,
                "start_date": "2025-11-15",
                "end_date": "2025-11-30",
                "categories": ["electronics", "appliances", "fashion"],
                "total_participants": 125840,
                "orders_generated": 28540,
                "revenue_generated": 3865320.50,
                "avg_conversion_lift_pct": 185.4,
                "customer_acquisition_cost": 3.10,
                "repeat_purchase_rate_pct": 42.1
            },
            {
                "promotion_id": "CYBER2025",
                "name": "Cyber Monday Deal - 40% + Free Shipping",
                "type": "percentage_discount",
                "discount_pct": 40,
                "start_date": "2025-11-24",
                "end_date": "2025-12-01",
                "categories": ["electronics"],
                "total_participants": 72350,
                "orders_generated": 16245,
                "revenue_generated": 1945280.30,
                "avg_conversion_lift_pct": 142.8,
                "customer_acquisition_cost": 2.80,
                "repeat_purchase_rate_pct": 38.5
            },
            {
                "promotion_id": "YEAR2025",
                "name": "Year-End Clearance - 30% Off",
                "type": "percentage_discount",
                "discount_pct": 30,
                "start_date": "2025-12-01",
                "end_date": "2025-12-31",
                "categories": ["appliances", "home_living", "sports"],
                "total_participants": 95420,
                "orders_generated": 18540,
                "revenue_generated": 1485320.20,
                "avg_conversion_lift_pct": 112.5,
                "customer_acquisition_cost": 4.15,
                "repeat_purchase_rate_pct": 26.3
            }
        ]
    },
    "time_behavior": {
        "hourly_pattern": [
            {"hour": 8, "revenue": 85420.30, "orders": 585, "promotion_orders_pct": 28.5},
            {"hour": 12, "revenue": 125680.50, "orders": 862, "promotion_orders_pct": 32.1},
            {"hour": 18, "revenue": 185320.80, "orders": 1272, "promotion_orders_pct": 38.5},
            {"hour": 19, "revenue": 215640.40, "orders": 1478, "promotion_orders_pct": 41.2},
            {"hour": 20, "revenue": 245820.60, "orders": 1685, "promotion_orders_pct": 44.5},
            {"hour": 21, "revenue": 268540.30, "orders": 1842, "promotion_orders_pct": 46.8},
            {"hour": 22, "revenue": 235680.50, "orders": 1615, "promotion_orders_pct": 43.2},
            {"hour": 23, "revenue": 182450.70, "orders": 1251, "promotion_orders_pct": 38.9}
        ],
        "peak_window": {
            "day": "Saturday",
            "hour": 21,
            "revenue": 285450.80,
            "orders": 1958,
            "promotion_orders_pct": 48.5,
            "insight": "Highest sales occur on weekend nights (Fri-Sun, 20:00-22:00)"
        }
    },
    "funnel": {
        "available": False,
        "message": "Lazada order API does not provide browse or product view counts in this project.",
        "view": 0,
        "cart": 0,
        "purchase": 85620,
        "view_to_cart_pct": 0.0,
        "cart_to_purchase_pct": 0.0,
        "drop_off_view_to_cart_pct": 0.0,
        "drop_off_cart_to_purchase_pct": 0.0
    },
    "products": {
        "top_by_revenue": [
            {"product_id": 1003461, "product_name": "iPhone 15 Pro Max 256GB", "category": "electronics", "category_code": "electronics.smartphone", "revenue": 825420.40, "quantity": 1284, "avg_price": 642.85, "revenue_share_pct": 6.61, "cumulative_share_pct": 6.61},
            {"product_id": 1003478, "product_name": "Samsung Galaxy S24 Ultra", "category": "electronics", "category_code": "electronics.smartphone", "revenue": 692580.25, "quantity": 1198, "avg_price": 578.11, "revenue_share_pct": 5.55, "cumulative_share_pct": 12.16},
            {"product_id": 2001120, "product_name": "Dyson V15 Detect", "category": "home_living", "category_code": "home_living.vacuum", "revenue": 485330.80, "quantity": 742, "avg_price": 654.08, "revenue_share_pct": 3.89, "cumulative_share_pct": 16.05},
            {"product_id": 3004511, "product_name": "Nike Air Zoom Pegasus 41", "category": "fashion", "category_code": "fashion.sneakers", "revenue": 352440.60, "quantity": 2865, "avg_price": 123.02, "revenue_share_pct": 2.82, "cumulative_share_pct": 18.87},
            {"product_id": 4008820, "product_name": "Estee Lauder Advanced Night Repair", "category": "beauty", "category_code": "beauty.skincare", "revenue": 318920.35, "quantity": 2140, "avg_price": 149.03, "revenue_share_pct": 2.55, "cumulative_share_pct": 21.42},
            {"product_id": 5001200, "product_name": "Philips Airfryer XXL", "category": "appliances", "category_code": "appliances.kitchen", "revenue": 295610.70, "quantity": 910, "avg_price": 324.85, "revenue_share_pct": 2.37, "cumulative_share_pct": 23.79}
        ],
        "top_by_quantity": [
            {"product_id": 3004511, "product_name": "Nike Air Zoom Pegasus 41", "category": "fashion", "category_code": "fashion.sneakers", "revenue": 352440.60, "quantity": 2865, "avg_price": 123.02},
            {"product_id": 4008820, "product_name": "Estee Lauder Advanced Night Repair", "category": "beauty", "category_code": "beauty.skincare", "revenue": 318920.35, "quantity": 2140, "avg_price": 149.03},
            {"product_id": 1003461, "product_name": "iPhone 15 Pro Max 256GB", "category": "electronics", "category_code": "electronics.smartphone", "revenue": 825420.40, "quantity": 1284, "avg_price": 642.85},
            {"product_id": 1003478, "product_name": "Samsung Galaxy S24 Ultra", "category": "electronics", "category_code": "electronics.smartphone", "revenue": 692580.25, "quantity": 1198, "avg_price": 578.11}
        ],
        "pareto": {
            "top_products_for_80pct": 58,
            "product_count": 302,
            "top_20pct_product_count": 61,
            "products": [
                {"product_id": 1003461, "product_name": "iPhone 15 Pro Max 256GB", "category": "electronics", "category_code": "electronics.smartphone", "revenue": 825420.40, "quantity": 1284, "avg_price": 642.85, "revenue_share_pct": 6.61, "cumulative_share_pct": 6.61},
                {"product_id": 1003478, "product_name": "Samsung Galaxy S24 Ultra", "category": "electronics", "category_code": "electronics.smartphone", "revenue": 692580.25, "quantity": 1198, "avg_price": 578.11, "revenue_share_pct": 5.55, "cumulative_share_pct": 12.16},
                {"product_id": 2001120, "product_name": "Dyson V15 Detect", "category": "home_living", "category_code": "home_living.vacuum", "revenue": 485330.80, "quantity": 742, "avg_price": 654.08, "revenue_share_pct": 3.89, "cumulative_share_pct": 16.05},
                {"product_id": 3004511, "product_name": "Nike Air Zoom Pegasus 41", "category": "fashion", "category_code": "fashion.sneakers", "revenue": 352440.60, "quantity": 2865, "avg_price": 123.02, "revenue_share_pct": 2.82, "cumulative_share_pct": 18.87},
                {"product_id": 4008820, "product_name": "Estee Lauder Advanced Night Repair", "category": "beauty", "category_code": "beauty.skincare", "revenue": 318920.35, "quantity": 2140, "avg_price": 149.03, "revenue_share_pct": 2.55, "cumulative_share_pct": 21.42},
                {"product_id": 5001200, "product_name": "Philips Airfryer XXL", "category": "appliances", "category_code": "appliances.kitchen", "revenue": 295610.70, "quantity": 910, "avg_price": 324.85, "revenue_share_pct": 2.37, "cumulative_share_pct": 23.79}
            ]
        }
    },
    "customers": {
        "daily_active_users": [
            {"event_date": "2025-12-18", "dau": 9342},
            {"event_date": "2025-12-19", "dau": 9588},
            {"event_date": "2025-12-20", "dau": 10452},
            {"event_date": "2025-12-21", "dau": 10211},
            {"event_date": "2025-12-22", "dau": 9864},
            {"event_date": "2025-12-23", "dau": 10108},
            {"event_date": "2025-12-24", "dau": 10895},
            {"event_date": "2025-12-25", "dau": 11244},
            {"event_date": "2025-12-26", "dau": 11580},
            {"event_date": "2025-12-27", "dau": 11892},
            {"event_date": "2025-12-28", "dau": 11735},
            {"event_date": "2025-12-29", "dau": 10954},
            {"event_date": "2025-12-30", "dau": 11320},
            {"event_date": "2025-12-31", "dau": 11984}
        ],
        "new_vs_returning": [
            {"event_date": "2025-12-18", "new": 2824, "returning": 6518},
            {"event_date": "2025-12-19", "new": 2910, "returning": 6678},
            {"event_date": "2025-12-20", "new": 3270, "returning": 7182},
            {"event_date": "2025-12-21", "new": 3118, "returning": 7093},
            {"event_date": "2025-12-22", "new": 2954, "returning": 6910},
            {"event_date": "2025-12-23", "new": 3021, "returning": 7087},
            {"event_date": "2025-12-24", "new": 3398, "returning": 7497},
            {"event_date": "2025-12-25", "new": 3482, "returning": 7762},
            {"event_date": "2025-12-26", "new": 3595, "returning": 7985},
            {"event_date": "2025-12-27", "new": 3710, "returning": 8182},
            {"event_date": "2025-12-28", "new": 3621, "returning": 8114},
            {"event_date": "2025-12-29", "new": 3314, "returning": 7640},
            {"event_date": "2025-12-30", "new": 3442, "returning": 7878},
            {"event_date": "2025-12-31", "new": 3695, "returning": 8289}
        ],
        "top_customers": [
            {"user_id": 8800211, "customer_revenue": 28245.60, "purchase_count": 14, "quantity": 29, "first_seen_at": "2025-05-12T09:15:00+00:00", "last_seen_at": "2025-12-31T15:42:00+00:00", "lifetime_days": 234, "clv_estimate": 2017.54},
            {"user_id": 8800248, "customer_revenue": 24890.30, "purchase_count": 11, "quantity": 18, "first_seen_at": "2025-03-22T03:08:00+00:00", "last_seen_at": "2025-12-29T18:30:00+00:00", "lifetime_days": 283, "clv_estimate": 2262.75}
        ]
    },
    "segments": {
        "segments": [
            {"user_id": 8800211, "frequency": 14, "monetary": 28245.60, "recency": 0, "rfm_score": 12, "segment": "VIP"},
            {"user_id": 8800248, "frequency": 11, "monetary": 24890.30, "recency": 2, "rfm_score": 11, "segment": "VIP"},
            {"user_id": 8800999, "frequency": 3, "monetary": 1520.40, "recency": 44, "rfm_score": 5, "segment": "At Risk"}
        ],
        "segment_summary": [
            {"segment": "VIP", "customers": 982, "revenue": 3982140.35, "avg_recency": 7.8},
            {"segment": "Loyal", "customers": 4210, "revenue": 3311188.76, "avg_recency": 15.1},
            {"segment": "Growth Opportunity", "customers": 2688, "revenue": 1893420.55, "avg_recency": 19.4},
            {"segment": "At Risk", "customers": 1468, "revenue": 781245.22, "avg_recency": 39.7}
        ],
        "churn_risk": [
            {"user_id": 8800999, "frequency": 3, "monetary": 1520.40, "recency": 44, "rfm_score": 5, "segment": "At Risk"},
            {"user_id": 8801452, "frequency": 2, "monetary": 980.25, "recency": 51, "rfm_score": 4, "segment": "At Risk"},
            {"user_id": 8802108, "frequency": 1, "monetary": 420.00, "recency": 72, "rfm_score": 3, "segment": "At Risk"}
        ]
    },
    "insights": [
        {
            "title": "Promotion-Driven Growth",
            "detail": "Promotional campaigns contributed 35.2% of total 2025 revenue, with Black Friday driving 48.2% of transactions.",
            "action": "Allocate more budget to high-performing periods (Nov-Dec) and replicate Black Friday strategy quarterly."
        },
        {
            "title": "Evening Peak Performance",
            "detail": "Peak sales occur on Saturday evenings (20:00-22:00) with 48.5% of transactions involving promotions.",
            "action": "Schedule major promotions on Thursday evenings through Sunday to maximize ROI."
        },
        {
            "title": "Electronics Dominance",
            "detail": "Electronics category generates 42% of revenue with 52.3% YoY growth, strongly driven by flash sales.",
            "action": "Increase inventory and promotion frequency for electronics to capitalize on demand."
        },
        {
            "title": "Fashion Category Growth",
            "detail": "Fashion category shows 42.5% YoY growth with highest promotion responsiveness (78.5%).",
            "action": "Expand fashion promotions and collaborate with influencers to drive sustained growth."
        },
        {
            "title": "Customer Acquisition Opportunity",
            "detail": "Black Friday 2025 acquired 38,540 new customers at $3.10 CAC with $312.80 LTV.",
            "action": "Plan early for Black Friday 2026 and test similar mega-sale strategies quarterly."
        }
    ]
}

# Write the data file
script_dir = Path(__file__).parent
output_path = script_dir / "data" / "analytics" / "dashboard_data.json"
output_path.parent.mkdir(parents=True, exist_ok=True)
with open(output_path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)

print(f"✓ Updated {output_path} with 2025 data and promotional analytics")
