package com.dhc6trainer.domain.knowledge.model

/**
 * Canonical system taxonomy for knowledge extraction + study engine.
 * Keep this stable; use displayTitle() to evolve UI labeling without breaking storage.
 */
enum class AircraftSystem {
    GENERAL,
    ATA_100,
    AIRCRAFT_GENERAL,
    STANDARD_AIRFRAME_PRACTICES,
    EQUIPMENT_FURNISHINGS,
    STRUCTURES,
    LIMITATIONS,

    POWERPLANT,
    ENGINE_STANDARD_PRACTICES,
    ENGINE,
    IGNITION,
    STARTING,
    PROPELLER,
    FUEL,
    ELECTRICAL,

    HYDRAULICS,
    FLIGHT_CONTROLS,
    LANDING_GEAR_FLOATS,
    LANDING_GEAR_WHEELS,
    LANDING_GEAR_SKI,

    AVIONICS,
    INDICATIONS_ALERTING,

    FIRE_PROTECTION,
    ICE_RAIN_PROTECTION,

    AIR_SYSTEMS,
    ENGINE_INDICATION,
    EXHAUST,
    OIL,
    ENGINE_CONTROLS,
    ENGINE_FUEL_CONTROL,

    AIR_CONDITIONING,
    ENVIRONMENTAL,

    PERFORMANCE,
    OPERATIONS_TECHNIQUES,
    EMERGENCY_EQUIPMENT;

    fun displayTitle(): String = when (this) {
        GENERAL -> "General"
        ATA_100 -> "Aircraft Manual Structure"
        AIRCRAFT_GENERAL -> "Aircraft General"
        STANDARD_AIRFRAME_PRACTICES -> "Standard Airframe Practices"
        EQUIPMENT_FURNISHINGS -> "Equipment and Furnishings"
        STRUCTURES -> "Structures"
        LIMITATIONS -> "Limitations"
        POWERPLANT -> "Powerplant"
        ENGINE_STANDARD_PRACTICES -> "Engine Standard Practices"
        ENGINE -> "Engine"
        IGNITION -> "Ignition"
        STARTING -> "Starting"
        PROPELLER -> "Propeller"
        FUEL -> "Fuel"
        ELECTRICAL -> "Electrical"
        HYDRAULICS -> "Hydraulics"
        FLIGHT_CONTROLS -> "Flight Controls"
        LANDING_GEAR_FLOATS -> "Landing Gear / Floats"
        LANDING_GEAR_WHEELS -> "Landing Gear / Wheels"
        LANDING_GEAR_SKI -> "Landing Gear / Ski"
        AVIONICS -> "Avionics"
        INDICATIONS_ALERTING -> "Indications & Alerting"
        FIRE_PROTECTION -> "Fire Protection"
        ICE_RAIN_PROTECTION -> "Ice & Rain Protection"
        AIR_SYSTEMS -> "Air Systems"
        ENGINE_INDICATION -> "Engine Indication"
        EXHAUST -> "Exhaust"
        OIL -> "Oil"
        ENGINE_CONTROLS -> "Engine Controls"
        ENGINE_FUEL_CONTROL -> "Engine Fuel and Control"
        AIR_CONDITIONING -> "Air Conditioning"
        ENVIRONMENTAL -> "Environmental"
        PERFORMANCE -> "Performance"
        OPERATIONS_TECHNIQUES -> "Operating Techniques"
        EMERGENCY_EQUIPMENT -> "Emergency Equipment"
    }
}