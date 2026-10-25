# Model Referral System - Implementation Plan

## Overview
Introduce a **Model Referral Program** exclusively for creators (models) to refer other models. This is separate from the existing user referral system.

---

## Business Logic

### Commission Structure
- **Withdraw Commission**: 10% (platform takes 10% on model withdrawals)
- **Model Referral Bonus**: 5% of referred model's withdrawal amount → credited to referrer's **earning wallet**
- Platform keeps 5% (half of 10% withdraw commission)
- Referrer gets 5% of referred model's withdrawal amount

### Eligibility
- **Only Creators (Models)** can participate
- Both referrer and referee must be `user_type: "creator"`
- Referrer must be an approved creator (`is_approved: true`, `verification_status: "approved"`)

### Trigger
- **Trigger**: When a referred model makes a withdrawal
- **Bonus Calculation**: 5% of withdrawal amount → credited to referrer's **earning wallet** (not spendable balance)
- **Frequency**: Every withdrawal by referred model

---

## Database Changes

### 1. User Collection Updates
```javascript
// users collection - new fields
{
  // ... existing fields
  user_type: "creator",
  // Model Referral fields
  model_referral_code: "MDL_ABC123",      // Unique model referral code (format: MDL_XXXXXX)
  model_referred_by: "user_id_of_referrer", // user_id of referring model
  model_referral_rewarded_at: ISODate,    // Last time referral bonus was paid
  model_referral_earnings: 0.00,          // Total earned from model referrals
  model_referrals: [                      // Array of referred models
    {
      user_id: "referred_model_id",
      name: "Model Name",
      joined_at: ISODate,
      total_withdrawals: 0.00,
      total_earned_from_them: 0.00,
      status: "active" | "inactive"
    }
  ]
}
```

### 2. Transactions Collection - New Transaction Types
```javascript
// New transaction types for model referrals
{
  type: "MODEL_REFERRAL_BONUS",           // Credit to referrer
  amount: 50.00,                          // 5% of withdrawal
  description: "Model referral bonus - from {referred_model_name}'s withdrawal",
  metadata: {
    referred_user_id: "model_user_id",
    withdrawal_amount: 1000,
    bonus_percentage: 5,
    bonus_amount: 50.00
  }
}
```

---

## API Changes

### 1. New Endpoints
```
GET  /api/model-referral/overview          - Get model referral overview
POST /api/model-referral/apply             - Apply model referral code (during/after signup)
GET  /api/model-referral/earnings          - Detailed earnings from model referrals
GET  /api/model-referral/referrals         - List of referred models with details
```

### 2. Updated Endpoints
- `POST /api/auth/verify-otp` - Accept optional `model_referral_code` during signup
- `POST /api/auth/complete-profile` - Accept `model_referral_code` for creators

### 3. Updated Withdrawal Endpoint
- `POST /api/wallet/withdraw` - Trigger model referral bonus on successful withdrawal

---

## Database Changes

### 1. Users Collection - New Fields
```javascript
{
  // ... existing fields
  // Model Referral fields
  model_referral_code: "MDL_ABC123XYZ",      // Unique model referral code (format: MDL_XXXXXX)
  model_referred_by: "user_id_of_referrer",   // Referrer's user_id
  model_referral_earnings: 0.00,              // Total earned from model referrals
  model_referral_rewarded_at: ISODate,        // Last time referral bonus was paid
  model_referrals: [                           // Array of referred models
    {
      user_id: "referred_model_id",
      name: "Referred Model Name",
      joined_at: ISODate,
      total_withdrawals: 0.00,
      total_bonus_from_them: 0.00,
      status: "active" | "inactive"
    }
  ]
}
```

### 2. Transactions Collection - New Types
```javascript
// Model Referral Bonus (credit to referrer)
{
  transaction_id: "txn_...",
  user_id: "referrer_user_id",
  type: "MODEL_REFERRAL_BONUS",
  amount: 50.00,  // 5% of withdrawal
  status: "SUCCESS",
  description: "Model referral bonus - from ModelName's ₹1000 withdrawal",
  metadata: {
    referred_user_id: "model_user_id",
    withdrawal_amount: 1000,
    bonus_percentage: 5,
    bonus_amount: 50.00
  },
  created_at: ISODate
}
```

---

## API Implementation Plan

### 1. Model Referral Service (`app/services/model_referral_service.py`)
```python
async def ensure_model_referral_code(user: dict) -> str:
    """Generate model referral code for creator if not exists."""
    
async def get_model_referral_overview(user: dict) -> dict:
    """Get model referral overview - earnings, referrals, stats."""
    
async def apply_model_referral_code(user: dict, code: str) -> dict:
    """Apply model referral code during/after signup."""
    
async def process_model_referral_bonus(withdrawal_user_id: str, withdrawal_amount: float):
    """Called when a model makes a withdrawal - credit referrer 5%."""
```

### 2. Router (`app/routers/model_referral.py`)
```python
@router.get("/overview")
async def model_referral_overview(user: dict = Depends(require_creator)):

@router.post("/apply")
async def apply_model_referral_code(body: ModelReferralApplyRequest, user: dict = Depends(require_user)):
    
@router.get("/earnings")
async def model_referral_earnings(user: dict = Depends(require_creator)):
    
@router.get("/referrals")
async def model_referral_list(user: dict = Depends(require_creator)):
```

### 3. Update Withdrawal Endpoint
In `wallet_router.py` withdraw endpoint, after successful withdrawal:
```python
# After successful withdrawal for a creator
if user["user_type"] == "creator":
    await model_referral_service.process_model_referral_bonus(
        user["user_id"], 
        withdrawal_amount
    )
```

---

## Mobile App Changes

### 1. Referral Screen (`app/(tabs)/referral.tsx`)
- **Two tabs**: "My Referrals" (user referral) | "Model Referral" (creator only)
- Model Referral tab only visible for `user_type === "creator"`

### 2. Model Referral Screen (`app/model-referral.tsx`)
- Own model referral code + share
- Earnings overview (total, pending, this month)
- Referred models list with details
- Withdrawal history with bonus earned

### 3. Signup Flow (`app/(auth)/complete-profile.tsx`)
- Add model referral code input when user selects "Creator" role
- Pre-fill if came via deep link

### 4. Earnings Screen (`app/earnings.tsx`)
- Add "Model Referral Earnings" section
- Show breakdown of referral bonuses

### 5. Transactions Screen
- Add "Model Referral Bonus" transaction type filter
- Show in transaction list with special badge

### 5. Withdraw Screen
- Show "You'll earn 5% referral bonus for your referrer" note

---

## Admin Dashboard Changes

### 1. Model Referral Analytics Page
- Total model referral bonuses paid
- Top referrers leaderboard
- Monthly referral revenue tracking
- Referral funnel: Invited → Signed up → First withdrawal → Paid bonus

### 2. Transaction Monitoring
- Filter by `MODEL_REFERRAL_BONUS` type
- Track 5% platform margin on referral bonuses

---

## Share Message Format

### Model Referral Share Message
```
🌟 Join {APP_NAME} as a Creator!

I've earned ₹{earnings} referring models. You can too!

🎁 Your Benefits:
✅ ₹20 welcome bonus on first recharge
✅ 5% lifetime referral bonus on your withdrawals (to your referrer)
✅ Full control over your rates & schedule
✅ Weekly payouts to UPI/Bank

📋 How to join:
1️⃣ Download {APP_NAME}
2️⃣ Sign up as "Creator"
3️⃣ Enter my code: {CODE}
4️⃣ Complete verification
5️⃣ Set your rates & go live!

🔗 {share_url}

#SimpleTalk #CreatorEconomy #WorkFromHome
```

---

## Admin Dashboard Updates

### 1. Model Referral Dashboard
- Total referral bonuses paid
- Active referrers count
- Top 10 referrers
- Monthly referral revenue
- Conversion funnel: Invite → Signup → Verified → First Withdrawal → Bonus Paid

### 2. Transaction Monitoring
- Filter by `MODEL_REFERRAL_BONUS`
- Track 5% platform margin
- Audit trail for disputes

---

## Implementation Priority

### Phase 1: Core Backend (Week 1)
1. Database migrations
2. Model Referral Service
3. Router endpoints
4. Withdrawal integration

### Phase 2: Mobile App (Week 2)
1. Referral tab - Model Referral tab
2. Model Referral screen
3. Signup integration
4. Earnings/Transactions UI

### Phase 3: Admin Dashboard (Week 3)
1. Model Referral Dashboard
2. Transaction monitoring

### Phase 4: Testing & Launch (Week 4)
1. End-to-end testing
2. Load testing
4. Production deployment

---

## Configuration (config.py additions)
```python
model_referral_bonus_percentage: float = 5.0
model_referral_min_withdrawal: float = 100.0  # Minimum withdrawal to trigger bonus
model_referral_code_prefix: str = "MDL"
model_referral_code_length: int = 6
```

---

## Edge Cases Handled
1. **Self-referral prevention**: User cannot use own code
2. **Duplicate prevention**: Can't apply code if already referred
4. **Self-referral prevention**: Can't use own code
5. **Inactive referrer**: If referrer becomes inactive, bonus still paid (earned)
5. **Fraud prevention**: Minimum withdrawal ₹100 to trigger bonus
6. **Circular referrals**: A→B→A prevented by checking referral chain
7. **Deactivated models**: Bonus still paid if referrer was active at referral time

---

## Testing Checklist
- [ ] Model A refers Model B → B withdraws ₹1000 → A gets ₹50
- [ ] Model B referred by A → B withdraws ₹50 → No bonus (below ₹100 minimum)
- [ ] Self-referral blocked
- [ ] Inactive referrer still gets bonus
- [ ] Multiple referrals tracked correctly
- [ ] Admin dashboard shows correct totals
- [ ] Transaction history shows MODEL_REFERRAL_BONUS type
- [ ] Admin dashboard shows correct totals
- [ ] Push notifications sent on bonus credit
- [ ] Deep link with referral code works from cold start

---

## Migration Script (SQL/Mongo)
```javascript
// Add model referral fields to existing users
db.users.updateMany(
  { user_type: "creator" },
  {
    $set: {
      model_referral_code: { $concat: ["MDL_", { $substr: ["$user_id", 0, 6] }] },
      model_referral_earnings: 0.0,
      model_referrals: []
    }
  }
)
```

---

## Deployment Checklist
- [ ] Database migration runs
- [ ] API endpoints deployed
- [ ] Mobile app built with new screens
- [ ] Admin dashboard updated
- [ ] Push notifications for referral bonus
- [ ] Deep link handling for referral codes
- [ ] Analytics events for referral funnel
- [ ] Load test referral bonus processing

---

## Rollback Plan
- Feature flag: `model_referral_enabled` (default: false)
- Can disable instantly if issues arise
- Data preserved for rollback