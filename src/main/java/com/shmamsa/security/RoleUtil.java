
package com.shmamsa.security;

import java.util.List;

public class RoleUtil {

    public static final List<String> ORDERED = List.of(
            "MAKHDOM",
            "KHADIM",
            "AMIN_OSRA",
            "AMIN_KHEDMA",
            "DEVELOPER"
    );

    public static int level(String role) {
        if (role == null) return 0;
        int idx = ORDERED.indexOf(role);
        return idx >= 0 ? idx : 0;
    }

    public static boolean isAtLeast(String role, String required) {
        return level(role) >= level(required);
    }

    public static boolean isDeveloper(String role) {
        return "DEVELOPER".equals(role);
    }

    public static boolean canChangeRoles(String actorRole) {
        return "AMIN_KHEDMA".equals(actorRole) || "DEVELOPER".equals(actorRole);
    }

    public static boolean canAssign(String actorRole, String targetRole) {
        // Developer can assign anything
        if ("DEVELOPER".equals(actorRole)) return true;

        // Amin khedma can assign anything except DEVELOPER
        if ("AMIN_KHEDMA".equals(actorRole)) {
            return !"DEVELOPER".equals(targetRole);
        }
        return false;
    }
}
