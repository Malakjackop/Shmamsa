package com.shmamsa.config;

import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class CustomRegistrationFieldSchemaMigration implements CommandLineRunner {

    private static final int REQUIRED_RULE_COLUMN_LENGTH = 255;
    private static final int SHOW_IN_COLUMN_LENGTH = 60;
    private static final int VISIBILITY_CONDITIONS_COLUMN_LENGTH = 4000;
    private static final String PROFILE_EDITABLE_SYSTEM_KEYS_SQL = "'email','phoneNumber','address','guardiansPhone','guardianRelation','schoolName','schoolGrade','universityName','faculty','universityGrade','graduatedFrom','graduateJob','workDetails'";

    private final JdbcTemplate jdbcTemplate;

    @Override
    public void run(String... args) {
        Integer currentLength = jdbcTemplate.query(
                """
                select character_maximum_length
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'custom_registration_fields'
                  and column_name = 'required_rule'
                """,
                rs -> rs.next() ? (Integer) rs.getObject(1) : null
        );

        if (currentLength != null && currentLength < REQUIRED_RULE_COLUMN_LENGTH) {
            jdbcTemplate.execute(
                    "alter table custom_registration_fields alter column required_rule type varchar(" +
                            REQUIRED_RULE_COLUMN_LENGTH +
                            ")"
            );
        }

        Integer showInLength = jdbcTemplate.query(
                """
                select character_maximum_length
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'custom_registration_fields'
                  and column_name = 'show_in'
                """,
                rs -> rs.next() ? (Integer) rs.getObject(1) : null
        );

        if (showInLength != null && showInLength < SHOW_IN_COLUMN_LENGTH) {
            jdbcTemplate.execute(
                    "alter table custom_registration_fields alter column show_in type varchar(" +
                            SHOW_IN_COLUMN_LENGTH +
                            ")"
            );
        }

        Integer visibilityConditionsLength = jdbcTemplate.query(
                """
                select character_maximum_length
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'custom_registration_fields'
                  and column_name = 'visibility_conditions'
                """,
                rs -> rs.next() ? (Integer) rs.getObject(1) : null
        );

        if (visibilityConditionsLength == null) {
            jdbcTemplate.execute(
                    "alter table custom_registration_fields add column visibility_conditions varchar(" +
                            VISIBILITY_CONDITIONS_COLUMN_LENGTH +
                            ")"
            );
        } else if (visibilityConditionsLength < VISIBILITY_CONDITIONS_COLUMN_LENGTH) {
            jdbcTemplate.execute(
                    "alter table custom_registration_fields alter column visibility_conditions type varchar(" +
                            VISIBILITY_CONDITIONS_COLUMN_LENGTH +
                            ")"
            );
        }

        Integer showInConfiguredExists = jdbcTemplate.query(
                """
                select 1
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'custom_registration_fields'
                  and column_name = 'show_in_configured'
                """,
                rs -> rs.next() ? 1 : null
        );

        if (showInConfiguredExists == null) {
            jdbcTemplate.execute(
                    "alter table custom_registration_fields add column show_in_configured boolean default false"
            );
        }

        jdbcTemplate.execute(
                "update custom_registration_fields set show_in_configured = false where show_in_configured is null"
        );

        Integer profileEditableExists = jdbcTemplate.query(
                """
                select 1
                from information_schema.columns
                where table_schema = current_schema()
                  and table_name = 'custom_registration_fields'
                  and column_name = 'profile_editable'
                """,
                rs -> rs.next() ? 1 : null
        );

        boolean profileEditableColumnCreated = false;
        if (profileEditableExists == null) {
            jdbcTemplate.execute(
                    "alter table custom_registration_fields add column profile_editable boolean default false"
            );
            profileEditableColumnCreated = true;
        }

        jdbcTemplate.execute(
                "update custom_registration_fields set profile_editable = false where profile_editable is null"
        );

        if (profileEditableColumnCreated) {
            jdbcTemplate.execute(
                    "update custom_registration_fields " +
                            "set profile_editable = true " +
                            "where is_system = true and field_key in (" + PROFILE_EDITABLE_SYSTEM_KEYS_SQL + ")"
            );
        }
    }
}
