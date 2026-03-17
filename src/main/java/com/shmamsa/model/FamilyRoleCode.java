package com.shmamsa.model;

import java.util.Locale;

public enum FamilyRoleCode {
    AMIN_KHEDMA(1, "AMIN_KHEDMA"),
    AMIN_OSRA(2, "AMIN_OSRA"),
    KHADIM(3, "KHADIM"),
    MAKHDOM(4, "MAKHDOM");

    private final int code;
    private final String roleName;

    FamilyRoleCode(int code, String roleName) {
        this.code = code;
        this.roleName = roleName;
    }

    public int getCode() {
        return code;
    }

    public String getRoleName() {
        return roleName;
    }

    public static FamilyRoleCode fromCode(Integer code) {
        if (code == null) return MAKHDOM;
        for (FamilyRoleCode value : values()) {
            if (value.code == code) return value;
        }
        return MAKHDOM;
    }

    public static FamilyRoleCode fromRole(String rawRole) {
        String role = String.valueOf(rawRole == null ? "" : rawRole).trim().toUpperCase(Locale.ROOT);
        if (role.startsWith("ROLE_")) role = role.substring(5);
        role = role.replaceAll("[-\\s]+", "_");
        return switch (role) {
            case "AMIN_KHEDMA" -> AMIN_KHEDMA;
            case "AMIN_OSRA" -> AMIN_OSRA;
            case "KHADIM" -> KHADIM;
            default -> MAKHDOM;
        };
    }
}
