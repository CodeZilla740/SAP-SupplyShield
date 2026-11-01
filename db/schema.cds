entity medicines {
  key sku          : String(20);
      name         : String(80) not null;
      min_temp     : Decimal(4,1) not null;
      max_temp     : Decimal(4,1) not null;
      unit         : String(10) not null;
      case_size    : Integer not null;
      unit_cost    : Decimal(9,2);
      batch        : String(20);
      manufactured : String(10);
      expiry       : String(10);
      gdp_class    : String(40);
}

entity facilities {
  key code        : String(10);
      name        : String(80) not null;
      city        : String(40);
      type        : String(10) not null;
      priority    : String(2);
      ward        : String(40);
      storage_loc : String(20);
}

entity inventory {
  key facility : Association to facilities @assert.integrity: 'DB';
  key product  : Association to medicines @assert.integrity: 'DB';
      qty_on_hand  : Integer not null;
      reserved_qty : Integer not null default 0;
      daily_usage  : Integer not null default 0;
      safety_stock : Integer not null default 0;
}

entity carriers {
  key code                 : String(20);
      name                 : String(80) not null;
      mode                 : String(10) not null;
      cold_chain_certified : Integer not null default 0;
      min_temp             : Decimal(4,1);
      max_temp             : Decimal(4,1);
      base_cost            : Decimal(9,2) not null;
      cost_per_km          : Decimal(7,2) not null;
      avg_speed_kmh        : Decimal(6,1) not null;
      handling_hours       : Decimal(4,1) not null;
      telemetry_capable    : Integer not null default 0;
      vehicle              : String(20);
}

entity lanes {
  key id : Integer;
      @assert.integrity: 'DB'
      origin : Association to facilities not null;
      @assert.integrity: 'DB'
      destination : Association to facilities not null;
      mode        : String(10) not null;
      distance_km : Decimal(8,1) not null;
      @assert.integrity: 'DB'
      carrier : Association to carriers;
}

entity purchase_orders {
  key ebeln         : String(10);
      supplier_name : String(80);
      @assert.integrity: 'DB'
      product : Association to medicines not null;
      @assert.integrity: 'DB'
      destination : Association to facilities not null;
      qty         : Integer not null;
      port        : String(10);
      status      : String(20) not null;
      eta         : String(10);
}

entity shipments {
  key id                : String(10);
      po                : Association to purchase_orders;
      @assert.integrity: 'DB'
      product           : Association to medicines not null;
      batch             : String(20);
      @assert.integrity: 'DB'
      origin            : Association to facilities;
      origin_label      : String(40);
      @assert.integrity: 'DB'
      destination       : Association to facilities;
      destination_label : String(60);
      route             : String(40);
      status            : String(20) not null;
      risk              : String(10) not null;
      delay_hours       : Decimal(6,1) not null default 0;
      eta_text          : String(20);
      current_temp      : Decimal(4,1);

}

entity temperature_readings {
  key id : Integer;
      @assert.integrity: 'DB'
      shipment : Association to shipments not null;
      batch    : String(20);
      ts       : String(30) not null;
      temp_c   : Decimal(4,1) not null;
}

entity disruptions {
  key id                   : String(20);
      type                 : String(30) not null;
      title                : String(120) not null;
      port                 : String(10);
      severity             : String(10) not null;
      description          : String(500);
      status               : String(20) not null;
      radius_km            : Decimal(6,1);
      wind_kmh             : Decimal(6,1);
      expected_delay_hours : Decimal(6,1);
      affected_shipments   : Integer default 0;
      affected_pos         : Integer default 0;
      verified             : Integer not null default 0;
      source               : String(120);
      created_at           : String(30);
}

entity disruption_timeline {
  key id : Integer;
      @assert.integrity: 'DB'
      disruption : Association to disruptions not null;
      ts          : String(10);
      title       : String(80);
      text        : String(300);
      state       : String(10);
}

entity infrastructure_status {
  key id : Integer;
      @assert.integrity: 'DB'
      disruption : Association to disruptions not null;
      label       : String(60);
      status      : String(20);
      tone        : String(10);
      icon        : String(20);
}

entity alerts {
  key id       : Integer;
      severity : String(10);
      location : String(60);
      medicine : String(60);
      message  : String(200);
      ago      : String(20);
}

entity recovery_plans {
  key id                    : String(20);
      @assert.integrity: 'DB'
      disruption            : Association to disruptions not null;
      run_id                : String(20) not null;
      correlation_id        : String(20) not null;
      status                : String(20) not null;
      recommended_option_id : String(20);
      score                 : Decimal(5,1);
      explanation           : LargeString;
      explanation_source    : String(200);
      created_at            : String(30);
      decided_at            : String(30);
      decided_by            : String(80);
      decision_comment      : String(300);
}

entity recovery_options {
  key id             : String(20);
      @assert.integrity: 'DB'
      plan            : Association to recovery_plans not null;
      code           : String(10) not null;
      title          : String(120) not null;
      source_code    : String(10);
      @assert.integrity: 'DB'
      carrier         : Association to carriers;
      qty            : Integer default 0;
      cost_usd       : Decimal(9,2) default 0;
      eta_hours      : Decimal(6,1) default 0;
      feasible       : Integer default 1;
      compliant      : Integer default 1;
      meets_deadline : Integer default 1;
      eligible       : Integer default 0;
      rank           : Integer default 0;
      recommended    : Integer default 0;
      status         : String(20) default 'PROPOSED';
      reason         : LargeString;
      checks_json    : LargeString;
      scores_json    : LargeString;

}

entity approvals {
  key id             : String(40);
      @assert.integrity: 'DB'
      plan            : Association to recovery_plans not null;
      @assert.integrity: 'DB'
      option          : Association to recovery_options;
      decision       : String(10) not null;
      actor          : String(80) not null;
      comment        : String(300);
      created_at     : String(30);
      execution_note : String(400);
}

entity audit_log {
  key seq       : Integer;
      run_id    : String(20);
      ts        : String(30) not null;
      actor     : String(40) not null;
      step      : String(120) not null;
      payload   : LargeString;
      prev_hash : String(64) not null;
      hash      : String(64) not null;
}

entity pipeline_state {
  key name : String(20);
      value : Integer not null;
}

entity network_stats {
  key metric : String(40);
      value  : Decimal(10,2) not null;
      unit   : String(10);
      detail : String(80);
}
