package com.shmamsa.repository;

import com.shmamsa.model.AttendanceArchive;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AttendanceArchiveRepository extends JpaRepository<AttendanceArchive, Long> {
}
